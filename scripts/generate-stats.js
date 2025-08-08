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
  // Format numbers with commas for readability
  const formatNumber = (num) => num.toLocaleString();
  
  const statsData = [
    { icon: '🚀', label: 'GitHub Stats', value: '', isTitle: true },
    { icon: '📊', label: 'Public Repos', value: formatNumber(stats.publicRepos) },
    { icon: '⭐', label: 'Total Stars', value: formatNumber(stats.totalStars) },
    { icon: '💻', label: 'Total Commits', value: formatNumber(stats.totalCommits) },
    { icon: '🔀', label: 'Total PRs', value: formatNumber(stats.totalPRs) },
    { icon: '🐛', label: 'Total Issues', value: formatNumber(stats.totalIssues) },
    { icon: '📧', label: 'Email', value: stats.email }
  ];

  // Calculate the width needed
  const maxLabelLength = Math.max(...statsData.filter(s => !s.isTitle).map(s => s.label.length));
  const maxValueLength = Math.max(...statsData.filter(s => !s.isTitle).map(s => s.value.length));
  const titleLength = 'GitHub Stats'.length;
  
  // Box width calculation: icon + space + label + colon + space + value + padding
  const contentWidth = 2 + maxLabelLength + 2 + maxValueLength + 4; // 2 for icon+space, 2 for ": ", 4 for padding
  const boxWidth = Math.max(contentWidth, titleLength + 6, 35);

  const topBorder = '┌' + '─'.repeat(boxWidth - 2) + '┐';
  const middleBorder = '├' + '─'.repeat(boxWidth - 2) + '┤';
  const bottomBorder = '└' + '─'.repeat(boxWidth - 2) + '┘';

  // Create title line (centered)
  const titleText = '🚀 GitHub Stats';
  const titlePadding = Math.floor((boxWidth - 2 - titleText.length) / 2);
  const titleLeftPad = ' '.repeat(titlePadding);
  const titleRightPad = ' '.repeat(boxWidth - 2 - titleText.length - titlePadding);
  const titleLine = `│${titleLeftPad}${titleText}${titleRightPad}│`;

  // Create data lines (left aligned with proper spacing)
  const dataLines = statsData
    .filter(item => !item.isTitle)
    .map(item => {
      const leftPart = `${item.icon} ${item.label}:`;
      const spaces = boxWidth - leftPart.length - item.value.length - 3; // 3 for │ and │
      return `│ ${leftPart}${' '.repeat(spaces)}${item.value} │`;
    });

  const asciiStats = [
    topBorder,
    titleLine,
    middleBorder,
    ...dataLines,
    bottomBorder
  ].join('\n');

  return asciiStats;
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
