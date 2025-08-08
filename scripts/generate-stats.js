const { Octokit } = require('@octokit/rest');
const { graphql } = require('@octokit/graphql');
const fs = require('fs');

class GitHubStatsGenerator {
  constructor() {
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    this.graphqlWithAuth = graphql.defaults({
      headers: { authorization: `token ${process.env.GITHUB_TOKEN}` },
    });
    this.username = process.env.USERNAME;
  }

  async fetchUserData() {
    const { data: user } = await this.octokit.rest.users.getByUsername({
      username: this.username,
    });
    return user;
  }

  async fetchRepositories() {
    const { data: repos } = await this.octokit.rest.repos.listForUser({
      username: this.username,
      per_page: 100,
    });
    return repos;
  }

  async fetchAllTimeCommits(joinDate) {
    const joinYear = new Date(joinDate).getFullYear();
    const currentYear = new Date().getFullYear();
    let totalCommits = 0;

    console.log(`Fetching commits from ${joinYear} to ${currentYear}...`);

    for (let year = joinYear; year <= currentYear; year++) {
      try {
        const yearCommits = await this.fetchCommitsForYear(year);
        totalCommits += yearCommits;
        console.log(`${year}: ${yearCommits} commits`);
        
        // Rate limiting protection
        if (year < currentYear) {
          await this.sleep(50);
        }
      } catch (error) {
        console.log(`Failed to fetch commits for ${year}:`, error.message);
      }
    }

    return totalCommits;
  }

  async fetchCommitsForYear(year) {
    const query = `
      query($username: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $username) {
          contributionsCollection(from: $from, to: $to) {
            totalCommitContributions
            restrictedContributionsCount
          }
        }
      }
    `;

    const result = await this.graphqlWithAuth(query, {
      username: this.username,
      from: `${year}-01-01T00:00:00Z`,
      to: `${year}-12-31T23:59:59Z`,
    });

    const { totalCommitContributions, restrictedContributionsCount } = 
      result.user.contributionsCollection;
    
    return totalCommitContributions + restrictedContributionsCount;
  }

  async fetchSearchStats(type) {
    try {
      const { data } = await this.octokit.rest.search.issuesAndPullRequests({
        q: `author:${this.username} type:${type}`,
        per_page: 1,
      });
      return data.total_count;
    } catch (error) {
      console.log(`Could not fetch ${type} data:`, error.message);
      return 0;
    }
  }

  async fetchAllStats() {
    try {
      console.log('Fetching GitHub stats...');
      
      const [user, repos] = await Promise.all([
        this.fetchUserData(),
        this.fetchRepositories(),
      ]);

      const totalStars = repos.reduce((acc, repo) => acc + repo.stargazers_count, 0);
      const publicRepos = user.public_repos;
      const email = user.email || 'Not public';

      // Fetch remaining stats concurrently
      const [totalCommits, totalPRs, totalIssues] = await Promise.all([
        this.fetchAllTimeCommits(user.created_at),
        this.fetchSearchStats('pr'),
        this.fetchSearchStats('issue'),
      ]);

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
generateASCII(stats) {
  const formatNumber = (num) => num.toLocaleString();

  const statsLines = [
    { label: 'Public Repos', value: formatNumber(stats.publicRepos) },
    { label: 'Total Stars', value: formatNumber(stats.totalStars) },
    { label: 'Total Commits', value: formatNumber(stats.totalCommits) },
    { label: 'Total PRs', value: formatNumber(stats.totalPRs) },
    { label: 'Total Issues', value: formatNumber(stats.totalIssues) },
    { label: 'Email', value: stats.email },
  ];

  // Determine widths
  const labelColumnWidth = Math.max(...statsLines.map(line => line.label.length));
  const valueColumnWidth = Math.max(...statsLines.map(line => line.value.length));
  const titleText = 'GitHub Stats';
  const titleWidth = titleText.length;

  // Total width = label + colon + underscores + value + borders & spaces
  const contentWidth = labelColumnWidth + 1 +  // label + colon
                       5 +                      // min underscores, you can adjust
                       valueColumnWidth;
  const boxWidth = Math.max(contentWidth + 4, titleWidth + 4); // +4 for borders and spaces

  // Borders
  const border = {
    top: '┌' + '─'.repeat(boxWidth - 2) + '┐',
    middle: '├' + '─'.repeat(boxWidth - 2) + '┤',
    bottom: '└' + '─'.repeat(boxWidth - 2) + '┘',
  };

  // Center title
  const titlePadding = Math.floor((boxWidth - 2 - titleText.length) / 2);
  const titleLine = `│${' '.repeat(titlePadding)}${titleText}${' '.repeat(boxWidth - 2 - titleText.length - titlePadding)}│`;

  // Data lines with underscore fillers
  const dataLines = statsLines.map(line => {
    const leftPart = `${line.label}:`;
    const totalFillLength = boxWidth - 4 - leftPart.length - line.value.length; // 4 = 2 borders + 2 spaces
    const fill = '_'.repeat(totalFillLength > 0 ? totalFillLength : 0);
    return `│ ${leftPart}${fill}${line.value} │`;
  });

  return [
    border.top,
    titleLine,
    border.middle,
    ...dataLines,
    border.bottom
  ].join('\n');
}

  updateReadme(asciiStats) {
    const readmePath = 'README.md';
    let content = '';

    try {
      content = fs.readFileSync(readmePath, 'utf8');
    } catch (error) {
      console.log('README.md not found, creating new one');
    }

    const markers = {
      start: '<!-- ASCII_STATS_START -->',
      end: '<!-- ASCII_STATS_END -->'
    };

    const newSection = `${markers.start}\n\`\`\`\n${asciiStats}\n\`\`\`\n${markers.end}`;
    const startIndex = content.indexOf(markers.start);
    const endIndex = content.indexOf(markers.end);

    if (startIndex !== -1 && endIndex !== -1) {
      // Replace existing section
      content = content.substring(0, startIndex) + 
                newSection + 
                content.substring(endIndex + markers.end.length);
    } else {
      // Append new section
      content += '\n\n' + newSection;
    }

    fs.writeFileSync(readmePath, content);
    console.log('README.md updated successfully!');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async run() {
    const stats = await this.fetchAllStats();
    console.log('Generating ASCII stats...');
    const asciiStats = this.generateASCII(stats);
    console.log('Updating README.md...');
    this.updateReadme(asciiStats);
    console.log('Done!');
  }
}

// Execute
const generator = new GitHubStatsGenerator();
generator.run().catch(console.error);
