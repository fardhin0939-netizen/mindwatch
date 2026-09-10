import os
import re


NEGATORS = {
    "not", "no", "never", "dont", "don't", "do not", "cannot", "can't",
    "cant", "isn't", "isnt", "arent", "aren't", "wasn't", "wasnt",
    "without", "barely", "hardly", "nor", "none"
}

INTENSIFIERS = {
    "very", "really", "so", "extremely", "totally", "absolutely",
    "quite", "super", "highly", "deeply", "terribly", "incredibly"
}

NEGATIVE = {
    "sad", "sadness", "depressed", "depression", "depressing", "stress",
    "stressed", "stressful", "anxious", "anxiety", "tired", "lonely",
    "loneliness", "hopeless", "helpless", "worried", "worry", "fear",
    "afraid", "scared", "angry", "anger", "upset", "cry", "crying",
    "exhausted", "overwhelmed", "difficult", "difficulty", "worthless",
    "empty", "numb", "panic", "dread", "low", "hurt", "pain", "painful"
}

POSITIVE = {
    "happy", "happiness", "good", "great", "calm", "relaxed", "healthy",
    "better", "best", "positive", "hopeful", "hope", "energetic",
    "peaceful", "confident", "grateful", "joy", "joyful", "content",
    "fine", "okay", "ok", "love", "loved", "safe", "strong", "rested"
}

CRISIS = {
    "suicide", "suicidal", "kill myself", "killing myself", "end my life",
    "end my own life", "self harm", "self-harm", "harm myself",
    "take my life", "don't want to live", "want to die", "better off dead"
}


def _lexicon_score(tokens):
    """Negation- and intensifier-aware local scoring."""

    neg_score = 0.0
    pos_score = 0.0

    for i, word in enumerate(tokens):

        multiplier = 1.0
        if (i > 0 and tokens[i - 1] in INTENSIFIERS) or \
           (i > 1 and tokens[i - 2] in INTENSIFIERS):
            multiplier = 1.5

        negated = (
            (i > 0 and tokens[i - 1] in NEGATORS) or
            (i > 1 and tokens[i - 2] in NEGATORS)
        )

        if word in NEGATIVE:
            if negated:
                pos_score += 0.5
            else:
                neg_score += 1.0 * multiplier

        elif word in POSITIVE:
            if negated:
                neg_score += 0.5
            else:
                pos_score += 1.0 * multiplier

    return neg_score, pos_score


def analyze_text(text):
    """Local, privacy-friendly text analysis (no external calls).

    Returns a sentiment label, an educational 0-100 text risk score,
    and a word count. Optionally uses an LLM when API credentials are
    configured (see analyze_text_with_llm).
    """

    if not text or not text.strip():
        return {
            "sentiment": "Neutral",
            "text_risk": 0,
            "word_count": 0
        }

    lower = text.lower()
    tokens = re.findall(r"\b\w+\b", lower)
    word_count = len(tokens)

    # Crisis language always maps to maximum risk.
    crisis = any(phrase in lower for phrase in CRISIS)

    neg_score, pos_score = _lexicon_score(tokens)

    if pos_score > neg_score:
        sentiment = "Positive"
    elif neg_score > pos_score:
        sentiment = "Negative"
    else:
        sentiment = "Neutral"

    text_risk = int(neg_score * 12)
    if neg_score >= 4:
        text_risk += 15
    if neg_score >= 7:
        text_risk += 20
    if crisis:
        text_risk = 100

    text_risk = min(100, text_risk)

    return {
        "sentiment": sentiment,
        "text_risk": text_risk,
        "word_count": word_count
    }


def analyze_text_with_llm(text):
    """Optional LLM-based analysis.

    Activated only when MINDWATCH_LLM_API_KEY and MINDWATCH_LLM_URL are
    set in the environment. Falls back to the local analyzer on any
    error so the app never breaks.
    """

    api_key = os.environ.get("MINDWATCH_LLM_API_KEY")
    api_url = os.environ.get("MINDWATCH_LLM_URL")

    if not api_key or not api_url:
        return analyze_text(text)

    try:
        import requests

        prompt = (
            "You are a mental-health triage assistant. "
            "Given the user text, reply ONLY with JSON: "
            '{"sentiment": "Positive|Neutral|Negative", '
            '"text_risk": 0-100, "word_count": integer}. '
            "Text: " + text
        )

        response = requests.post(
            api_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": os.environ.get(
                    "MINDWATCH_LLM_MODEL", "gpt-3.5-turbo"
                ),
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0
            },
            timeout=10
        )

        content = response.json()["choices"][0]["message"]["content"]
        data = __import__("json").loads(content)
        data["word_count"] = len(re.findall(r"\b\w+\b", text.lower()))
        return data

    except Exception:
        return analyze_text(text)
