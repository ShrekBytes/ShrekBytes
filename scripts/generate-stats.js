// scripts/generate-stats.js
const { Octokit } = require('@octokit/rest');
const { graphql } = require('@octokit/graphql');
const fs = require('fs');

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_TOKEN}`,
  },
});

const username = process.env.USERNAME;

async function getGitHubStats() {
  try {
    // Get user info
    const { data: user } = await octokit.rest.users.getByUsername({
      username: username,
    });

    // Get repositories
    const { data: repos } = await octokit.rest.repos.listForUser({
      username: username,
      per_page: 100,
    });

    // Calculate basic stats
    const totalStars = repos.reduce((acc, repo) => acc + repo.stargazers_count, 0);
    const publicRepos = user.public_repos;
    const email = user.email || 'Not public';

    // Get total commits using GraphQL (includes private repos and all years)
    let totalCommits = 0;
    try {
      const query = `
        query($username: String!) {
          user(login: $username) {
            contributionsCollection {
              totalCommitContributions
            }
            contributionsCollection(from: "2008-01-01T00:00:00Z") {
              totalCommitContributions
            }
          }
        }
      `;
      
      const result = await graphqlWithAuth(query, { username });
      totalCommits = result.user.contributionsCollection.totalCommitContributions;
      
      // If that doesn't work, try getting all-time contributions
      if (totalCommits === 0) {
        const allTimeQuery = `
          query($username: String!) {
            user(login: $username) {
              contributionsCollection {
                totalCommitContributions
                restrictedContributionsCount
              }
            }
          }
        `;
        const allTimeResult = await graphqlWithAuth(allTimeQuery, { username });
        totalCommits = allTimeResult.user.contributionsCollection.totalCommitContributions + 
                      allTimeResult.user.contributionsCollection.restrictedContributionsCount;
      }
    } catch (error) {
      console.log('Could not fetch total commit data via GraphQL, falling back to REST API');
      // Fallback to original method
      for (const repo of repos.filter(r => !r.fork).slice(0, 10)) {
        try {
          const { data: commits } = await octokit.rest.repos.listCommits({
            owner: username,
            repo: repo.name,
            author: username,
            per_page: 100,
          });
          totalCommits += commits.length;
        } catch (error) {
          // Skip if can't fetch commits for this repo
        }
      }
    }

    // Get total PRs
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

    // Get total issues + discussions
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
  // Convert stats to strings
  const statsText = {
    repos: String(stats.publicRepos),
    stars: String(stats.totalStars),
    commits: String(stats.totalCommits),
    prs: String(stats.totalPRs),
    issues: String(stats.totalIssues),
    email: stats.email
  };

  // Find the longest value to determine box width
  const longestValue = Math.max(
    ...Object.values(statsText).map(val => val.length),
    20 // minimum width
  );

  // Calculate box width (longest value + labels + padding)
  const boxWidth = Math.max(45, longestValue + 25);
  const topBorder = '┌' + '─'.repeat(boxWidth - 2) + '┐';
  const middleBorder = '├' + '─'.repeat(boxWidth - 2) + '┤';
  const bottomBorder = '└' + '─'.repeat(boxWidth - 2) + '┘';

  // Helper function to create properly spaced lines
  function createLine(icon, label, value) {
    const content = `${icon} ${label}:`;
    const padding = boxWidth - content.length - value.length - 3; // 3 for │ spaces │
    return `│ ${content}${' '.repeat(padding)}${value} │`;
  }

  const asciiStats = `
${topBorder}
│${' '.repeat(Math.floor((boxWidth - 16) / 2))}🚀 GitHub Stats${' '.repeat(Math.ceil((boxWidth - 16) / 2))}│
${middleBorder}
${createLine('📊', 'Public Repos', statsText.repos)}
${createLine('⭐', 'Total Stars', statsText.stars)}
${createLine('💻', 'Total Commits', statsText.commits)}
${createLine('🔀', 'Total PRs', statsText.prs)}
${createLine('🐛', 'Total Issues', statsText.issues)}
${createLine('📧', 'Email', statsText.email)}
${bottomBorder}
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
    // Replace existing stats
    readmeContent = readmeContent.substring(0, startIndex) + 
                   newStatsSection + 
                   readmeContent.substring(endIndex + endMarker.length);
  } else {
    // Add stats at the end
    readmeContent += '\n\n' + newStatsSection;
  }

  fs.writeFileSync(readmePath, readmeContent);
  console.log('README.md updated successfully!');
}

main().catch(console.error);
