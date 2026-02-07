export interface DocSection {
  type: string;
  content?: string;
  language?: string;
  method?: string;
  path?: string;
  description?: string;
  params?: { name: string; type: string; description: string }[];
  response?: string;
  body?: Record<string, unknown>;
  cards?: { title: string; description: string; icon?: string }[];
  items?: string[];
  level?: number;
}

export interface DocPage {
  title: string;
  description: string;
  sections: DocSection[];
}

export interface NavGroup {
  group: string;
  pages: string[];
}

export interface GeneratedDocs {
  doc_type: string;
  title: string;
  description: string;
  navigation: NavGroup[];
  pages: Record<string, DocPage>;
}

export interface Repo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  clone_url: string;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  private: boolean;
}
