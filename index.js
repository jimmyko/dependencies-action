const core = require('@actions/core');
const github = require('@actions/github');

const keyPhrases = 'depends on|blocked by';
const issueTypes = 'issues|pull'
const quickLinkRegex = new RegExp(`(${keyPhrases}) #(\\d+)`, 'gmi');
const partialLinkRegex = new RegExp(`(${keyPhrases}) ([-_\\w]+)\\/([-._a-z0-9]+)(#)(\\d+)`, 'gmi');
const partialUrlRegex = new RegExp(`(${keyPhrases}) ([-_\\w]+)\\/([-._a-z0-9]+)\\/(${issueTypes})\\/(\\d+)`, 'gmi');
const fullUrlRegex = new RegExp(`(${keyPhrases}) https:\\/\\/github\\.com\\/([-_\\w]+)\\/([-._a-z0-9]+)\\/(${issueTypes})\\/(\\d+)`, 'gmi');
const markdownRegex = new RegExp(`(${keyPhrases}) \\[.*\\]\\(https:\\/\\/github\\.com\\/([-_\\w]+)\\/([-._a-z0-9]+)\\/(${issueTypes})\\/(\\d+)\\)`, 'gmi');

function extractFromMatch(match) {
    return {
        owner: match[2],
        repo: match[3],
        pull_number: parseInt(match[5], 10)
    };
}

function getDependency(line) {
    var match = quickLinkRegex.exec(line);
    if (match !== null) {
        core.info(`  Found number-referenced dependency in '${line}'`);
        return {
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number: parseInt(match[2], 10)
        };
    }

    match = partialLinkRegex.exec(line);
    if (match !== null) {
        core.info(`  Found partial-link dependency in '${line}'`);
        return extractFromMatch(match);
    }

    match = partialUrlRegex.exec(line);
    if (match !== null) {
        core.info(`  Found partial-url dependency in '${line}'`);
        return extractFromMatch(match);
    }

    match = fullUrlRegex.exec(line);
    if (match !== null) {
        core.info(`  Found full-url dependency in '${line}'`);
        return extractFromMatch(match);
    }

    match = markdownRegex.exec(line);
    if (match !== null) {
        core.info(`  Found markdown dependency in '${line}'`);
        return extractFromMatch(match);
    }

    core.info(`  Found no dependency in '${line}'`);
    return null;
};

async function run() {
    try {
        core.info('Initializing....');
        const myToken = process.env.GITHUB_TOKEN;
        const octokit = github.getOctokit(myToken);

        const { data: pullRequest } = await octokit.rest.pulls.get({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number: github.context.issue.number,
        });

        if (!pullRequest.body){
            core.info('body empty')
            return;
        }

        core.info('\nReading PR body...');
        const lines = pullRequest.body.split(/\r\n|\r|\n/);

        var dependencies = [];
        lines.forEach(l => {
            var dependency = getDependency(l);
            if (dependency !== null)
                dependencies.push(dependency);
        });

        core.info('\nAnalyzing lines...');
        var dependencyIssues = [];
        for (var d of dependencies) {
            core.info(`  Fetching '${JSON.stringify(d)}'`);
            var isPr = true;
            var response = await octokit.pulls.get(d).catch(error => core.error(error));
            if (response === undefined) {
                isPr = false;
                d = {
                    owner: d.owner,
                    repo: d.repo,
                    issue_number: d.pull_number,
                };
                core.info(`  Fetching '${JSON.stringify(d)}'`);
                response = await octokit.issues.get(d).catch(error => core.error(error));
                if (response === undefined) {
                    core.info('    Could not locate this dependency.  Will need to verify manually.');
                    continue;
                }
            }
            if (isPr) {
                const { data: pr } = response;
                if (!pr) continue;
                if (!pr.merged && !pr.closed_at) {
                    core.info('    PR is still open.');
                    dependencyIssues.push(pr);
                } else {
                    core.info('    PR has been closed.');
                }
            } else {
                const { data: issue } = response;
                if (!issue) continue;
                if (!issue.closed_at) {
                    core.info('    Issue is still open.');
                    dependencyIssues.push(issue);
                } else {
                    core.info('    Issue has been closed.');
                }
            }
        }

        if (dependencyIssues.length !== 0) {
            var msg = '\nThe following issues need to be resolved before this PR can be merged:\n';
            for (var pr of dependencyIssues) {
                msg += `\n#${pr.number} - ${pr.title}`;
            }
            core.setFailed(msg);
        } else {
            core.info("\nAll dependencies have been resolved!")
        }
    } catch (error) {
        core.setFailed(error.message);
        throw error;
    }
}

run();
