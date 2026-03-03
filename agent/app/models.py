from pydantic import BaseModel, Field
from typing import Literal


# --- Doc content schemas ---

class DocSection(BaseModel):
    type: Literal["heading", "paragraph", "codeBlock", "endpoint", "cardGroup", "table", "list"]
    content: str | None = None
    language: str | None = None
    method: str | None = None
    path: str | None = None
    description: str | None = None
    params: list[dict] | None = None
    response: str | None = None
    body: dict | None = None
    cards: list[dict] | None = None
    items: list[str] | None = None
    level: int | None = None

class DocPage(BaseModel):
    title: str
    description: str = ""
    sections: list[DocSection] = []

class NavGroup(BaseModel):
    group: str
    pages: list[str]

class GeneratedDocs(BaseModel):
    doc_type: str
    title: str
    description: str
    navigation: list[NavGroup]
    pages: dict[str, DocPage]


# --- LLM structured output schemas ---

class PagePlan(BaseModel):
    """Plan for a single documentation page."""
    title: str
    description: str = Field(description="What this page covers")
    source_files: list[str] = Field(default_factory=list, description="File paths this page documents")
    source_symbols: list[str] = Field(default_factory=list, description="Symbol names this page documents")

class DocPlan(BaseModel):
    """Documentation plan produced by the planning phase."""
    title: str
    description: str
    navigation: list[NavGroup]
    pages: dict[str, PagePlan]

class ClassifyResult(BaseModel):
    """Repository classification result."""
    doc_type: Literal["consumer", "devdocs", "library", "cli"]
    reasoning: str = Field(description="One sentence explaining why")

class RefineRouter(BaseModel):
    """Router agent output for refinement."""
    page_ids: list[str] = Field(description="Page IDs that need content changes")
    include_meta: bool = Field(default=False, description="Whether title/description should change")
    strategy: str = Field(description="Brief description of what to change")

class MetaUpdate(BaseModel):
    """Updated metadata from refine meta agent."""
    title: str
    description: str

class ValidationResult(BaseModel):
    """QA agent output."""
    valid: bool
    issues: list[str] = Field(default_factory=list)


# --- API request schemas ---

class GenerateRequest(BaseModel):
    repo_url: str
    doc_type: str | None = None
    github_token: str | None = None

class RefineRequest(BaseModel):
    prompt: str
    current_docs: GeneratedDocs
    repo_name: str
