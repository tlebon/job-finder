import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), '..', 'jobs.db');
const db = new Database(dbPath);

const profile = {
  id: 'default',
  name: 'Timothy LeBon',
  title: 'Frontend Web Developer',
  location: 'Berlin, Germany',
  email: 'timothy@star-dog.net',
  phone: '+491772566348',
  linkedin: 'linkedin.com/in/timothy-lebon',
  github: '',
  website: 'star-dog.net',
  summary: 'Frontend engineer and Engineering Manager with 6 years of experience. React/TypeScript expert with blockchain and encrypted messaging experience.',
  experience: `Engineering Manager | Wire™ | 06/2024 - 12/2024 | Berlin, DE
End-to-End Encrypted Collaboration App
• Guided the web team's personal development (6 engineers)
• Drove cross-functional initiatives across engineering, product, and design
• Led development of calling UI overhaul shipped to users
• Established TypeScript coding standards
• Oversaw infrastructure migrations

Senior Web Developer | Wire™ | 01/2022 - 06/2024 | Berlin, DE
End-to-End Encrypted Collaboration Platform
• React, TypeScript, Electron, AWS
• Project Lead for Wire Teams Admin Platform
• Built Account Entropy feature for new accounts
• Implemented Blurred Background for video calls
• Led various cross-team technical initiatives

Fullstack Developer | tz-connect gmbH | 06/2021 - 12/2021 | Berlin, DE
The Berlin hub for the Tezos ecosystem
• Built fullstack DApps integrating with Tezos APIs
• Architected and shipped Tezos NFT platform with Postgres, Nest.js, Prisma, React/TypeScript
• Worked with smart contracts, wallet integration (Temple/MetaMask), and Web3 technologies
• Handled complex async blockchain operations: pending transactions, confirmations, error states

Intermediate Software Engineer | diconium digital solutions GmbH | 03/2019 - 06/2021 | Berlin, DE
Agency for digital transformation
• Worked in Agile framework using React, TypeScript, GraphQL, Node

Web Development Teachers Assistant | Ironhack Berlin | 11/2018 - 12/2018 | Berlin, DE
• Helped students with React for their final projects
• Mentored young developers

EDUCATION
• Full Stack Web Development Bootcamp | Ironhack, Berlin | 2018
• Bachelor of Arts in Chemistry and Art | UC Santa Cruz | 2014

CERTIFICATES
• Mindful Meditation Teacher - 2-year certification program

ACHIEVEMENTS
• Walked 1000+ km from Berlin to France following St. James Way (2025)
• Berlin Half Marathon 2023 & 2024 (1:57:51)
• Won Comedy Cafe Berlin Cage Match with Improv Group Shredder (2025)`,
  skills: 'React, TypeScript, Node.js, Electron, GraphQL, Nest.js, Prisma, Web3/Blockchain, AWS, Git',
  preferences: 'Frontend/Fullstack/Engineering Manager roles in Berlin or willing to relocate within EU',
};

// Check if profile exists
const existing = db.prepare('SELECT id FROM profile WHERE id = ?').get('default');

if (existing) {
  db.prepare(`
    UPDATE profile SET
      name = ?, title = ?, location = ?, email = ?, phone = ?,
      linkedin = ?, github = ?, website = ?, summary = ?,
      experience = ?, skills = ?, preferences = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    profile.name, profile.title, profile.location, profile.email, profile.phone,
    profile.linkedin, profile.github, profile.website, profile.summary,
    profile.experience, profile.skills, profile.preferences, profile.id
  );
  console.log('Profile updated!');
} else {
  db.prepare(`
    INSERT INTO profile (id, name, title, location, email, phone, linkedin, github, website, summary, experience, skills, preferences)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    profile.id, profile.name, profile.title, profile.location, profile.email, profile.phone,
    profile.linkedin, profile.github, profile.website, profile.summary,
    profile.experience, profile.skills, profile.preferences
  );
  console.log('Profile created!');
}

db.close();
