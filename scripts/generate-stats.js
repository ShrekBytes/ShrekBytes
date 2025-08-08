const { Octokit } = require('@octokit/rest');
const fs = require('fs');

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const username = process.env.USERNAME;

async function getGitHubStats() {
  try {
    const { data: user } = await octokit.rest.users.getByUsername({
      username: username,
    });

    const { data: repos } = await octokit.rest.repos.listForUser({
      username: username,
      per_page: 100,
    });

    const totalStars = repos.reduce((acc, repo) => acc + repo.stargazers_count, 0);
    const publicRepos = user.public_repos;
    const email = user.email || 'Not public';

    let totalCommits = 0;
    try {
      for (const repo of repos.filter(r => !r.fork).slice(0, 10)) {
        try {
          const { data: commits } = await octokit.rest.repos.listCommits({
            owner: username,
            repo: repo.name,
            author: username,
            per_page: 100,
            since: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
          });
          totalCommits += commits.length;
        } catch (error) {
          // Skip if can't fetch commits for this repo
        }
      }
    } catch (error) {
      console.log('Could not fetch commit data');
    }

    let totalPRs = 0;
    try {
      const { data: prs } = await octokit.rest.search.issuesAndPullRequests({
        q: `author:${username} type:pr`,
        per_page: 1,
      });
      totalPRs = prs.total_count;
    } catch (error) {
      console.log('Could not fetch PR data');
    }

    let totalIssues = 0;
    try {
      const { data: issues } = await octokit.rest.search.issuesAndPullRequests({
        q: `author:${username} type:issue`,
        per_page: 1,
      });
      totalIssues = issues.total_count;
    } catch (error) {
      console.log('Could not fetch issue data');
    }

    return {
      totalStars,
      publicRepos,
      totalCommits,
      totalPRs,
      totalIssues,
      email,
    };
  } catch (error) {
    console.error('Error fetching GitHub stats:', error);
    process.exit(1);
  }
}

function generateASCIIStats(stats) {
  const asciiStats = `
┌─────────────────────────────────────────┐
│            🚀 GitHub Stats              │
├─────────────────────────────────────────┤
│  📊 Public Repos: ${String(stats.publicRepos).padStart(18)} │
│  ⭐ Total Stars:  ${String(stats.totalStars).padStart(18)} │
│  💻 Total Commits:${String(stats.totalCommits).padStart(18)} │
│  🔀 Total PRs:    ${String(stats.totalPRs).padStart(18)} │
│  🐛 Total Issues: ${String(stats.totalIssues).padStart(18)} │
│  📧 Email: ${stats.email.padEnd(26)} │
└─────────────────────────────────────────┘
`;
  return asciiStats.trim();
}

function updateReadme(asciiStats) {
  const readmePath = 'README.md';
  let readmeContent = '';

  try {
    readmeContent = fs.readFileSync(readmePath, 'utf8');
  } catch (error) {
    console.log('README.md not found, creating new one');
  }

  const startMarker = '<!-- ASCII_STATS_START -->';
  const endMarker = '<!-- ASCII_STATS_END -->';
  
  const newStatsSection = `${startMarker}\n\`\`\`\n${asciiStats}\n\`\`\`\n${endMarker}`;

  const startIndex = readmeContent.indexOf(startMarker);
  const endIndex = readmeContent.indexOf(endMarker);

  if (startIndex !== -1 && endIndex !== -1) {
    readmeContent = readmeContent.substring(0, startIndex) + 
                   newStatsSection + 
                   readmeContent.substring(endIndex + endMarker.length);
  } else {
    readmeContent += '\n\n' + newStatsSection;
  }

  fs.writeFileSync(readmePath, readmeContent);
  console.log('README.md updated successfully!');
}

async function main() {
  console.log('Fetching GitHub stats...');
  const stats = await getGitHubStats();
  
  console.log('Generating ASCII stats...');
  const asciiStats = generateASCIIStats(stats);
  
  console.log('Updating README.md...');
  updateReadme(asciiStats);
  
  console.log('Done! ✨');
}

main().catch(console.error);
