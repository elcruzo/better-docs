from pydantic import BaseModel

class DocSection(BaseModel):
    type: str
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

class GenerateRequest(BaseModel):
    repo_url: str
    doc_type: str | None = None

class RefineRequest(BaseModel):
    prompt: str
    current_docs: GeneratedDocs
    repo_name: str
