export interface PolicyEntry {
  number: string;          // e.g. "91.100"
  title: string;
  url: string;             // absolute URL to the policy page or PDF
  volume?: string;         // top-level volume label (e.g. "Volume 91 - Athletics")
  volumeNumber?: string;   // e.g. "91"
  section?: string;        // optional sub-section heading the entry was listed under
  lastUpdated?: string;    // ISO date if discoverable from index
  isPdf?: boolean;
}

export interface PolicyIndex {
  fetchedAt: number;
  source: string;
  policies: PolicyEntry[];
  volumes: { number: string; label: string; count: number }[];
}

export interface PolicyDocument {
  number: string;
  title: string;
  url: string;
  text: string;            // markdown / plain-text body
  effectiveDate?: string;
  reviewedDate?: string;
  lastRevisedDate?: string;
  approvedBy?: string;
  responsibleOffice?: string;
  history?: { date: string; note: string }[];
  isPdf: boolean;
  fetchedAt: number;
}
