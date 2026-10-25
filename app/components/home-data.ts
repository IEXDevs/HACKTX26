// Home page view model. The values below are placeholders until the
// dashboard API supplies them. Keep copy plain: no IDs, model names, or error codes.
export type HomeRequest = {
  id: string;
  workflow: string;
  ask: string;
  preview: string;
  waiting: string;
  action: string;
  href: string;
};
export type HomeStep = { name: string; state: 'done' | 'working' | 'next'; seconds?: number };
export type HomeOutput = { id: string; at: string; who: string; text: string };
export type HomeRun = {
  id: string;
  name: string;
  now: string;
  elapsed: string;
  steps: HomeStep[];
  output: HomeOutput[];
  // Text the working agent is producing right now, streamed from the orchestrator.
  draft?: { who: string; text: string };
  href: string;
};
export type HomeResult = {
  id: string;
  name: string;
  result: string;
  stopped?: boolean;
  agents: number;
  seconds: number;
  credits: number;
  action: string;
  href: string;
};
export type HomeData = {
  needs: HomeRequest[];
  running: HomeRun[];
  finished: HomeResult[];
};

export const placeholderHome: HomeData = {
  needs: [
    {
      id: 'need-1',
      workflow: 'Meetup planning',
      ask: 'Save the event brief?',
      preview: '80 people · $3,000 budget · near UT Austin',
      waiting: '6 min',
      action: 'Review',
      href: '/workflows',
    },
    {
      id: 'need-2',
      workflow: 'Community event',
      ask: 'Publish the sign-up page?',
      preview: 'A public page with an Interested button',
      waiting: '18 min',
      action: 'Review',
      href: '/workflows',
    },
    {
      id: 'need-3',
      workflow: 'Vendor research',
      ask: 'Check what it understood',
      preview: '6 requirements found in your brief',
      waiting: '1 min',
      action: 'Check',
      href: '/workflows',
    },
  ],
  running: [
    {
      id: 'run-1',
      name: 'Community event team',
      now: 'Finding venues near UT Austin',
      elapsed: '2m 14s',
      href: '/workflows',
      steps: [
        { name: 'Understand the brief', state: 'done', seconds: 3 },
        { name: 'Gather community context', state: 'done', seconds: 4 },
        { name: 'Check the evidence', state: 'done', seconds: 6 },
        { name: 'Find venues', state: 'working', seconds: 41 },
        { name: 'Flag risks', state: 'next' },
        { name: 'Plan the day', state: 'next' },
      ],
      output: [
        {
          id: 'o1',
          at: '2:00 PM',
          who: 'Orchestrator',
          text: 'Split the brief into 6 steps for 5 agents.',
        },
        {
          id: 'o2',
          at: '2:00 PM',
          who: 'Requirements analyst',
          text: '80 people, $3,000 budget, near UT Austin, outdoors if possible.',
        },
        {
          id: 'o3',
          at: '2:01 PM',
          who: 'Community context',
          text: 'Students prefer weekday evenings and venues they can walk to.',
        },
        {
          id: 'o4',
          at: '2:01 PM',
          who: 'Orchestrator',
          text: 'Kept 3 sources. Handed off to Venue researcher.',
        },
      ],
      draft: {
        who: 'Venue researcher',
        text: 'Comparing 6 venues within a mile of campus. So far: Riverside Hall fits 90 for about $1,200. The park pavilion fits 120 with a $450 permit',
      },
    },
    {
      id: 'run-2',
      name: 'Welcome email',
      now: 'Writing the first draft',
      elapsed: '38s',
      href: '/workflows',
      steps: [
        { name: 'Write the draft', state: 'working', seconds: 38 },
        { name: 'Review the draft', state: 'next' },
      ],
      output: [
        {
          id: 'o1',
          at: '2:01 PM',
          who: 'Orchestrator',
          text: 'Gave the brief to Thoughtful writer.',
        },
      ],
      draft: {
        who: 'Thoughtful writer',
        text: 'Hi everyone, and welcome to the HackTX community meetup. We are glad you are here. This page has everything you need for the evening',
      },
    },
  ],
  finished: [
    {
      id: 'done-1',
      name: 'Weekly recap',
      result: 'Report is ready',
      agents: 3,
      seconds: 160,
      credits: 1,
      action: 'Open',
      href: '/workflows',
    },
    {
      id: 'done-2',
      name: 'Speaker outreach',
      result: 'Draft emails are ready',
      agents: 2,
      seconds: 72,
      credits: 1,
      action: 'Open',
      href: '/workflows',
    },
    {
      id: 'done-3',
      name: 'Venue shortlist',
      result: 'Stopped. The web search did not respond.',
      stopped: true,
      agents: 3,
      seconds: 95,
      credits: 1,
      action: 'Try again',
      href: '/workflows',
    },
  ],
};
