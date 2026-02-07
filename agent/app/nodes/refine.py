import json, os
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage

llm = ChatAnthropic(model="claude-sonnet-4-20250514", api_key=os.getenv("ANTHROPIC_API_KEY"), max_tokens=8192)

REFINE_PROMPT = """You are a documentation editor for "better-docs". You receive existing documentation JSON and a user's refinement request. Update the documentation accordingly.

Return the COMPLETE updated documentation JSON (same schema as input). Only modify the parts the user asks about.

Rules:
- Preserve the existing structure unless the user asks to change it.
- No emojis. Clean professional language.
- Return ONLY valid JSON, no markdown fences."""

async def refine_docs(current_docs: dict, prompt: str, repo_name: str) -> dict:
    docs_str = json.dumps(current_docs, indent=2)[:6000]
    user_msg = f"""Current docs for "{repo_name}":
{docs_str}

User request: {prompt}

Return the updated documentation JSON."""

    response = await llm.ainvoke([SystemMessage(content=REFINE_PROMPT), HumanMessage(content=user_msg)])
    text = response.content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    return json.loads(text)
