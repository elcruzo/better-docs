import json, os
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage

llm = ChatAnthropic(model="claude-sonnet-4-20250514", api_key=os.getenv("ANTHROPIC_API_KEY"), max_tokens=8192)

SYSTEM_PROMPT = """You are a documentation generator for the product "better-docs". Given a codebase structure (files, symbols, types, functions, classes), generate a complete documentation site as structured JSON.

You MUST return valid JSON matching this schema:
{
  "doc_type": "consumer" | "devdocs",
  "title": "Project Name",
  "description": "Short description",
  "navigation": [{"group": "Group Name", "pages": ["page_id1", "page_id2"]}],
  "pages": {
    "page_id": {
      "title": "Page Title",
      "description": "Page description",
      "sections": [
        {"type": "paragraph", "content": "Text content"},
        {"type": "heading", "content": "Heading text", "level": 2},
        {"type": "codeBlock", "language": "python", "content": "code here"},
        {"type": "endpoint", "method": "GET", "path": "/users", "description": "...", "params": [{"name": "id", "type": "string", "description": "..."}], "response": "..."},
        {"type": "cardGroup", "cards": [{"title": "...", "description": "...", "icon": "code"}]},
        {"type": "table", "content": "markdown table"},
        {"type": "list", "items": ["item1", "item2"]}
      ]
    }
  }
}

Rules:
- Write clear, human-readable explanations. Not just API signatures.
- For consumer docs: focus on getting started, features, guides, configuration.
- For devdocs: focus on API reference, endpoints, types, authentication, error handling.
- No emojis. Use clean, professional language.
- Generate real content based on the code structure provided. Don't use placeholder text.
- Return ONLY the JSON object, no markdown fences or extra text."""

async def generate_docs(structure: list[dict], doc_type: str, repo_name: str, readme_content: str = "") -> dict:
    structure_str = json.dumps(structure[:100], indent=2)
    user_msg = f"""Generate {doc_type} documentation for the repository "{repo_name}".

README content:
{readme_content[:3000] if readme_content else "No README found."}

Codebase structure (files + symbols):
{structure_str}

Generate comprehensive documentation as JSON."""

    response = await llm.ainvoke([SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_msg)])
    text = response.content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    return json.loads(text)
