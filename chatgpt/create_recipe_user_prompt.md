# Create Recipe User Prompt

Use this prompt in ChatGPT when you want a recipe exported for PKM `/recipe-save`.

```text
Convert the recipe below into the exact PKM recipe Markdown format.

Rules:
- Output only the formatted recipe Markdown. No intro, no explanation, no code fences.
- Keep section names exactly as shown.
- Keep ingredient and instruction ordering faithful to the source.
- If a field is unknown, omit that metadata line.
- Notes section is optional.

Required structure:
# <Recipe Title>

- Servings: <number>
- Cuisine: <text>
- Protein: <text>
- Prep time: <minutes as integer>
- Cook time: <minutes as integer>
- Difficulty: <text>
- Tags: <comma-separated tags>
- Overnight: <true|false>
- URL: <canonical URL>

## Ingredients
- <ingredient 1>
- <ingredient 2>

## Instructions
1. <step 1>
2. <step 2>

## Notes
- <optional note>

Now convert this recipe:

<<<PASTE SOURCE RECIPE HERE>>>
```

## Quick send pattern
After ChatGPT returns the formatted Markdown, send to Telegram as:

```text
/recipe-save <paste full formatted markdown>
```
