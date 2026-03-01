import { projectCount, insertProject } from './services/Database.js';

const SEED_PROJECTS = [
  {
    name: 'BookBuddy',
    repo: 'amjad1233/luma',
    localPath: '/Users/amjad/sites/personal/luma',
    githubProjectId: 'PVT_kwHOAAoWms4BQYpB',
    githubProjectNumber: 2,
  },
  {
    name: 'Tractivity',
    repo: 'amjad1233/tractivity',
    localPath: '/Users/amjad/sites/personal/tractivity',
    githubProjectId: 'PVT_kwHOAAoWms4Azc8R',
    githubProjectNumber: 1,
  },
  {
    name: 'AgentArmy',
    repo: 'amjad1233/agent-army',
    localPath: '/Users/amjad/sites/personal/agent-army',
    githubProjectId: 'PVT_kwHOAAoWms4BQdEt',
    githubProjectNumber: 3,
  },
];

export function seedProjects() {
  if (projectCount() > 0) return;

  console.log('Seeding projects...');
  for (const project of SEED_PROJECTS) {
    insertProject(project);
    console.log(`  + ${project.name} (${project.repo})`);
  }
  console.log('Seed complete.');
}
