// Generated from shared API contracts by scripts/build-sdks.mjs.
export type Policy = {
  visibility:
    | 'PUBLIC'
    | 'UNLISTED'
    | 'AUTHENTICATED'
    | 'CONNECTIONS'
    | 'ORGANIZATION'
    | 'SPECIFIC_APPLICATIONS'
    | 'PRIVATE';
  searchable: boolean;
  indexable: boolean;
  api: boolean;
  machine: boolean;
  agent: boolean;
  applications: string[];
  transformation: 'FULL' | 'GENERALIZED' | 'ALIAS' | 'REDACTED' | 'HIDDEN';
  disclosedValue?: string;
};

export interface PublicClaim {
  id: string;
  key: string;
  value: unknown;
  locale: string;
  source: string;
  verification: string;
  freshness: string;
  updatedAt: string;
  policy?: Policy;
}

export interface PublicProfile {
  id: string;
  handle: string;
  type: string;
  persona: string | null;
  displayName: string;
  claims: PublicClaim[];
  blocks?: {
    id: string;
    kind: string;
    title: string;
    locale: string;
    configuration: {
      text: string;
      url?: string;
      items: { label: string; url: string; description?: string }[];
      mediaIds?: string[];
    };
  }[];
  avatarUrl: string;
  headerUrl?: string;
  contactEnabled: boolean;
  visibility: string;
  indexable: boolean;
  machine: boolean;
  agent: boolean;
  theme: string;
  locale: string;
  revision: number;
  canonicalHandle?: string;
  canonicalUrl?: string;
}

export interface ApiError {
  code: string;
  message: string;
  status: number;
  request_id: string;
  details?: unknown;
}
