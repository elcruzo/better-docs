import os

def get_llm():
    """Return a ChatModel — uses Bedrock if AWS creds are set, otherwise direct Anthropic."""
    model = os.getenv("LLM_MODEL", "claude-sonnet-4-20250514")
    max_tokens = int(os.getenv("LLM_MAX_TOKENS", "8192"))

    if os.getenv("AWS_BEDROCK", "").lower() in ("1", "true", "yes"):
        from langchain_aws import ChatBedrockConverse
        return ChatBedrockConverse(
            model=os.getenv("BEDROCK_MODEL_ID", f"anthropic.{model}"),
            region_name=os.getenv("AWS_REGION", "us-east-1"),
            max_tokens=max_tokens,
        )

    from langchain_anthropic import ChatAnthropic
    return ChatAnthropic(
        model=model,
        api_key=os.getenv("ANTHROPIC_API_KEY"),
        max_tokens=max_tokens,
    )
