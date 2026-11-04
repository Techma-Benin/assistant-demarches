# Console métier et opérateur

Vocabulaire de la console d’administration et de l’écran opérateur : qui fait quoi, et ce qu’on appelle une administration.

## Acteurs

**Officiel**:
Une personne de l’annuaire X-Road, rattachée à un compte Keycloak. Rôles possibles : agent, admin, super_admin.
_Avoid_: utilisateur (trop large), compte Keycloak (c’est l’identité, pas l’affectation)

**Agent**:
Un officiel rattaché à une administration, qui traite les dossiers de celle-ci.
_Avoid_: utilisateur

**Admin d’administration**:
Un officiel rattaché à une administration, qui traite les dossiers et gère les officiels de la sienne.
_Avoid_: administrateur (tout seul), super administrateur

**Super administrateur**:
Un officiel sans administration, qui voit les administrations connectées et y affecte des officiels. La console ne liste pas les administrations non connectées.
_Avoid_: opérateur, admin

**Opérateur**:
Un compte Keycloak distinct, rôle `operator`. Configure les modèles d’IA et les serveurs MCP, dans un écran séparé de la console.
_Avoid_: super administrateur

## Organisations et connexions

**Administration**:
Une organisation du catalogue officiel service-public.bj (ministère, ANIP, …) à laquelle sont rattachés des démarches, des dossiers et des officiels.
_Avoid_: département, ministère (trop étroit : l’ANIP n’en est pas un)

**Administration connectée**:
Une administration pour laquelle le X-Road simulé accepte des dépôts. Ce n’est pas un serveur MCP.
_Avoid_: administration MCP, administration joignable

**Serveur MCP**:
Un serveur d’outils que l’opérateur branche pour que l’assistant puisse appeler des outils. Ça ne connecte pas une administration.
_Avoid_: connexion X-Road, connexion d’administration
