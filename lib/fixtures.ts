import type { Requirements, Plan } from './config';
export const fixtureHistory = [
  {
    id: 'demo-history-1',
    title: 'Demonstration: previous community meetup',
    excerpt:
      'Synthetic organization history: a short welcome, small-group introductions, and a quiet discussion area helped first-time participants.',
  },
  {
    id: 'demo-preference-1',
    title: 'Demonstration: opted-in accessibility preferences',
    excerpt:
      'Synthetic opted-in preference aggregate: step-free access, clear arrival instructions, vegetarian food, and a quiet area. No real participant records.',
  },
  {
    id: 'demo-history-2',
    title: 'Demonstration: planning lessons',
    excerpt:
      'Synthetic organization history: reserve a contingency allocation and confirm room capacity, all-in price, date, and accessible entrances before publishing confirmed details.',
  },
];
export const fixtureVenues = [
  {
    id: 'demo-venue-hall',
    title: 'Demo University Neighborhood Hall',
    excerpt:
      'Fictional fixture venue near the requested area. Indoor gathering space; a separate quiet corner is a planning assumption. Price, capacity, accessibility and availability require confirmation.',
  },
  {
    id: 'demo-venue-garden',
    title: 'Demo Community Garden Pavilion',
    excerpt:
      'Fictional fixture venue near the requested area. Outdoor setting; weather cover and accessible paths need confirmation. Price, capacity and availability are unknown.',
  },
  {
    id: 'demo-venue-studio',
    title: 'Demo Campus Community Studio',
    excerpt:
      'Fictional fixture venue near the requested area. Workshop setting for structured introductions. Price, capacity, accessibility and availability are unknown.',
  },
];
export function extractFixture(brief: string): Requirements {
  const attendees = Number(
    brief
      .match(/(\d[\d,]*)\s*(?:people|attendees|guests|participants)/i)?.[1]
      ?.replaceAll(',', '') || 80,
  );
  const budget = Number(brief.match(/\$\s*([\d,]+(?:\.\d+)?)/)?.[1]?.replaceAll(',', '') || 3000);
  const location =
    brief
      .match(
        /(?:near|in)\s+([A-Za-z][A-Za-z .]+?)(?=\s+(?:for|with|within|on|and)\b|[,.\n]|$)/i,
      )?.[1]
      ?.trim() || 'UT Austin, Austin, Texas';
  const preferences = [
    'Welcoming to first-time participants',
    ...['outdoor', 'quiet', 'accessible', 'vegetarian', 'workshop', 'family'].filter((s) =>
      brief.toLowerCase().includes(s),
    ),
  ];
  return {
    title: 'Community meetup',
    location,
    attendees,
    budget,
    currency: 'USD',
    date: null,
    preferences,
    unknowns: [
      'Event date and time',
      'Venue all-in quotes',
      'Confirmed venue capacity and accessibility',
      'Availability',
    ],
  };
}
export function fixturePlan(
  req: Requirements,
  evidence: { id: string; title: string; excerpt: string }[],
  instructions: string,
): Plan {
  const outdoor = (req.preferences.join(' ') + ' ' + instructions)
    .toLowerCase()
    .includes('outdoor');
  const sources = evidence.filter((e) => e.id.startsWith('demo-venue'));
  const ordered = outdoor
    ? [
        sources.find((e) => e.id.includes('garden')),
        ...sources.filter((e) => !e.id.includes('garden')),
      ]
    : sources;
  const usable = ordered.filter((e): e is (typeof sources)[number] => !!e);
  const history = evidence
    .filter((e) => e.id.startsWith('demo-history') || e.id.startsWith('demo-preference'))
    .map((e) => e.id);
  const options = usable.slice(0, 3).map((e, i) => ({
    name: e.title,
    rationale: `${i === 0 ? 'Best planning fit' : 'Alternative'} for ${req.attendees} people near ${req.location}. ${outdoor ? 'Outdoor preference affects the order.' : 'A quiet welcome and small-group introductions are planning suggestions, not evidence about participants.'} ${e.excerpt}`,
    price: 'Unknown — request an all-in quote',
    capacity: `Unknown — confirm safe capacity for ${req.attendees}`,
    availability: 'Unknown — confirm date',
    sourceIds: [e.id, ...history],
  }));
  while (options.length < 3)
    options.push({
      name: 'Unresolved option ' + (options.length + 1),
      rationale: 'Insufficient venue evidence',
      price: 'Unknown',
      capacity: 'Unknown',
      availability: 'Unknown',
      sourceIds: history,
    });
  return {
    title: `Welcoming meetup near ${req.location}`,
    summary: `FIXTURE PLAN. A proposed meetup for ${req.attendees} people with a $${req.budget.toLocaleString()} USD planning limit. The venue order responds to your requirements and synthetic search evidence. No venue is confirmed.`,
    options,
    recommendation: {
      name: options[0].name,
      reason: `Provisional recommendation only. ${options[0].rationale} Obtain a quote and confirm safe capacity before selecting it.`,
      sourceIds: options[0].sourceIds,
    },
    schedule: [
      { time: 'T−30 min', activity: 'Check access, signs, quiet area, and food labels' },
      { time: '0:00', activity: 'Welcome and explain the space' },
      { time: '0:15', activity: 'Small-group introductions' },
      { time: '0:45', activity: 'Open conversation with a quiet option' },
      { time: '1:30', activity: 'Wrap up and invite feedback' },
    ],
    budget: [
      {
        item: 'Venue allocation',
        estimatedUsd: Math.floor(req.budget * 0.4),
        status: 'planning allocation',
      },
      {
        item: 'Food and non-alcoholic drinks',
        estimatedUsd: Math.floor(req.budget * 0.3),
        status: 'planning allocation',
      },
      {
        item: 'Accessibility and materials',
        estimatedUsd: Math.floor(req.budget * 0.15),
        status: 'planning allocation',
      },
      {
        item: 'Contingency',
        estimatedUsd:
          req.budget -
          Math.floor(req.budget * 0.4) -
          Math.floor(req.budget * 0.3) -
          Math.floor(req.budget * 0.15),
        status: 'planning allocation',
      },
    ],
    invitationDrafts: [
      `DRAFT — NOT SENT. You are welcome at our community meetup near ${req.location}. Meet neighbors and try small-group introductions. Date, venue, access details, and RSVP link need confirmation. We are planning for ${req.attendees} participants. Vegetarian food and a quiet area are proposed; please confirm your access needs with the organizer.`,
    ],
    unresolved: [
      ...req.unknowns,
      'Every venue is fictional in fixture mode. Replace with live evidence for a real plan.',
      'All budget lines are allocations, not vendor quotes.',
      'No invitations have been sent; no booking or purchase has been made.',
    ],
  };
}
