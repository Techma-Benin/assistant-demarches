# Prompts

`agent-v1.txt` définit le prompt système initial du Backend : réponses sourcées, usage des outils autorisés, consentement hors modèle et absence de code SMS officiel dans l’assistant. Sa version est sélectionnée par `ModelConfig.promptVersion`.

Toute modification du comportement doit passer par revue et évaluation sur le jeu métier ; les tests de transport ne prouvent pas la qualité des réponses.
