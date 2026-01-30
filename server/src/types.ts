/** Skill record stored in the cloud index. */
export interface SkillRecord {
  id: string;
  service: string;
  slug: string;
  version: number;
  baseUrl: string;
  authMethodType: string;
  endpoints: EndpointEntry[];
  skillMd: string;
  apiTemplate: string;
  creatorWallet: string;
  creatorAlias?: string;
  endpointCount: number;
  downloadCount: number;
  tags: string[];
  searchText: string;
  createdAt: string;
  updatedAt: string;
}

export interface EndpointEntry {
  method: string;
  path: string;
  description?: string;
}

/** What the publish endpoint receives. */
export interface PublishBody {
  service: string;
  baseUrl: string;
  authMethodType: string;
  endpoints: EndpointEntry[];
  skillMd: string;
  apiTemplate: string;
  creatorWallet: string;
}

/** What search returns per skill. */
export interface SkillSummary {
  id: string;
  service: string;
  slug: string;
  baseUrl: string;
  authMethodType: string;
  endpointCount: number;
  downloadCount: number;
  tags: string[];
  creatorWallet: string;
  creatorAlias?: string;
  updatedAt: string;
}

/** What download returns — the full skill package. */
export interface SkillPackage {
  id: string;
  service: string;
  baseUrl: string;
  authMethodType: string;
  endpoints: EndpointEntry[];
  skillMd: string;
  apiTemplate: string;
}
