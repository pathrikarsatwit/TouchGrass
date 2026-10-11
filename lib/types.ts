export type Place = {
  id: string;
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
  category?: string;
  source: string;
  attribution: string;
};

export type TimeSlot = {
  starts_at: string;
  ends_at: string;
  timezone: string;
  availability_complete: boolean;
  explanation: string;
};

export type Proposal = {
  id: string;
  title: string;
  description: string;
  city: string;
  place: Place;
  starts_at: string;
  ends_at: string;
  timezone: string;
  itinerary: string[];
  quests: string[];
  items_to_bring: string[];
  safety_notes: string[];
  budget_estimate: string;
  weather: { status: string; detail: string; checked_at?: string };
  ai_generated: boolean;
  generation_note?: string | null;
  availability_complete?: boolean;
  availability_note?: string | null;
  rsvp_status?: string | null;
  completed_quests?: string[];
  status: "draft" | "published";
};
