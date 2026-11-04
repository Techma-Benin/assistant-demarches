# Spécification fonctionnelle

Version du 1er novembre 2026, validée avant l'écriture du [contrat v2](../CONTRACTS.md). Sources : appel du 29 octobre (compte rendu et PowerPoint du pivot) et échange du 30 octobre.

## 1. Objet

L'usager fait sa démarche administrative en entier dans une conversation : il s'informe, prépare, dépose, paie et suit. Le dossier arrive dans une console d'administration unique, identique pour tous les ministères, où l'agent du ministère concerné le traite.

| Ce qu'on sait | Ce qu'on suppose | Ce qu'on choisit |
|---|---|---|
| Chaque administration expose ce qu'elle veut via X-Road. Toutes ne sont pas connectées. Chaque ministère a son propre écran. Des dossiers restent bloqués des semaines. | X-Road relie déjà les back-ends. Il est modulaire. Les rôles existent déjà. | Simuler un X-Road plus complet que l'existant. Une seule console pour tous. Dépôt, suivi et paiement chez nous. Design niveau Airbnb. |

## 2. Principes non négociables

1. **Rien en dur.** Tout ce qu'une interface affiche vient d'une API : thèmes, suggestions, chiffres, listes, profils.
2. **Réel ou simulé, jamais faux.** Les informations sur les démarches viennent du vrai catalogue de service-public.bj. Dépôt, paiement, décision et document délivré passent par le X-Road simulé et portent la mention « simulation ».
3. **Une seule source par donnée.**
4. **Pas de mocks dans l'application.** La démo tourne sur les vrais services.
5. **Chaque fonctionnalité listée marche de bout en bout**, sinon elle est retirée de la liste.
6. **Confidentialité.** L'agent IA ne lit jamais le contenu des pièces. La console ne montre jamais le texte des conversations.
7. **Une commande pour tout lancer**, sans Docker, avec les comptes de démo déjà créés.

## 3. Acteurs

| Acteur | Identité | Ce qu'il fait |
|---|---|---|
| Usager web | Anonyme pour s'informer, connexion Keycloak au moment de déposer | Pose des questions, dépose, paie, suit, complète, télécharge |
| Usager WhatsApp | Numéro vérifié par Meta, qui vaut connexion | Mêmes capacités, par messages |
| Agent de ministère | Compte Keycloak, affecté à un ministère dans le X-Road simulé | Traite les dossiers de son ministère |
| Admin de ministère | Idem, rôle `admin` | Agent + gère les agents de son ministère |
| Super admin | Idem, rôle `super_admin`, sans ministère | Voit les administrations connectées, crée et affecte les agents |
| Opérateur technique | Compte Keycloak, rôle `operator` | Configure le modèle et les MCP, dans un écran séparé |

## 4. Parcours de démonstration

1. L'usager arrive sur « Bonjour, Bénin » et demande « Comment obtenir mon casier judiciaire ? ».
2. L'assistant répond avec la fiche officielle (coût, délai, pièces) et sa source.
3. « Préparer ma demande » : questions naturelles, le panneau « vos informations » se remplit, l'usager dépose ses pièces.
4. Connexion, consentement, dépôt, paiement simulé. Le chat affiche la référence et la destination : Justice.
5. Console, agent Justice : **En attente (1)**. Agent Enseignement : **En attente (0)**. Super admin : il voit les deux.
6. L'agent Justice demande un complément. L'usager le reçoit dans le chat et le fournit. L'agent approuve.
7. L'usager reçoit le document délivré (marqué simulation) dans le chat. Le dossier passe dans **Complété**.
8. L'acte de naissance, complété par l'assistant seul, arrive directement dans **Complété** de l'ANIP.

## 5. Usager (web)

| # | Fonctionnalité | Critère « ça marche » |
|---|---|---|
| U1 | Accueil « Bonjour, Bénin » : question, thèmes, suggestions, confidentialité | Thèmes issus des administrations, suggestions issues des démarches réelles, aucun compteur inventé |
| U2 | Question en texte, réponse avec sources | Chaque information administrative cite sa fiche service-public.bj avec un lien |
| U3 | Message vocal | Enregistrement, transcription affichée, réponse |
| U4 | Conversation conservée | Rechargement sans perte ; « nouvelle conversation » |
| U5 | Démarche non déposable | Texte officiel et lien vers la fiche, dépôt chez nous indiqué comme non disponible |
| U6 | « Préparer ma demande » | Questions naturelles, étapes visibles, panneau « vos informations » avec la provenance de chaque donnée |
| U7 | Pièces demandées | Liste des pièces attendues, dépôt sur chaque ligne ; l'assistant voit « reçue », jamais le contenu |
| U8 | Connexion au dépôt | Connexion Keycloak au moment de déposer ; la conversation est rattachée au compte sans perte |
| U9 | Consentement | Texte fourni par le serveur, bouton d'accord, retrait possible |
| U10 | Dépôt | Référence de dossier et ministère destinataire affichés |
| U11 | Paiement simulé | Montant de la fiche, confirmation, mention simulation |
| U12 | Suivi | Statut mis à jour dans le chat sans recharger ; page « Mes démarches » |
| U13 | Complément demandé | Motif de l'agent dans le chat ; réponse ou pièce de l'usager ; le dossier repart chez l'agent |
| U14 | Document délivré | Téléchargeable depuis le chat et « Mes démarches » |
| U15 | Mobile d'abord | Tout le parcours utilisable sur téléphone |
| U16 | Chat intégrable | Un extrait de code intègre le chat dans un autre site |

## 6. WhatsApp

| # | Fonctionnalité | Critère |
|---|---|---|
| W1 | Même assistant que sur le web | Questions, sources, pièces, statut, par messages successifs |
| W2 | Notifications de suivi | Changement de statut, complément demandé, document délivré |
| W3 | Vrai numéro | Branché sur un numéro WhatsApp Business dès que l'équipe Interface a finalisé les démarches Meta |

## 7. Console d'administration

| # | Fonctionnalité | Critère |
|---|---|---|
| A1 | Connexion | Keycloak ; ministère et rôle lus dans le X-Road simulé ; changer de compte = se reconnecter |
| A2 | Vue d'ensemble | Chiffres réels : reçus, en attente, complétés par l'assistant ou un agent, rejetés, délai médian, démarches les plus demandées, dossiers par canal |
| A3 | En attente | Dossiers à traiter, avec ce que l'assistant a fait et ce qui demande une intervention |
| A4 | Détail d'un dossier | Champs, pièces téléchargeables, étapes, paiement, historique ; pas de texte de conversation |
| A5 | Actions | Prendre en charge, demander un complément (motif envoyé à l'usager), approuver (document délivré), rejeter (motif) |
| A6 | Complété | Dossiers terminés, par l'assistant ou un agent |
| A7 | Sans réponse | Questions non traitées : thème et motif, sans le texte ; marquer comme résolu |
| A8 | Journal | Qui a fait quoi sur quel dossier, quand ; pas de texte de conversation |
| A9 | Utilisateurs | L'admin voit ses agents et peut changer rôle ou actif ; le super admin crée un agent, l'affecte ou le désactive |
| A10 | Profil | Nom, fonction, photo |
| A11 | Super admin | Sélecteur des administrations connectées, mêmes écrans. Les non connectées n'apparaissent pas dans la console (aucune action pour les connecter) |
| A12 | Cloisonnement | Un agent ne voit que son ministère, refus côté serveur |

## 8. Écran opérateur

| # | Fonctionnalité | Critère |
|---|---|---|
| O1 | Modèles d'IA | Créer, modifier, activer un modèle ; l'assistant l'utilise sans redémarrer |
| O2 | MCP par URL | Ajouter une URL, découvrir les outils réels, activer chaque outil, choisir si un consentement est requis |
| O3 | État des connexions | Statut du modèle, des MCP et des administrations connectées |

## 9. X-Road simulé

| # | Fonctionnalité | Critère |
|---|---|---|
| X1 | Catalogue officiel | Fiches de l'API publique de service-public.bj, avec identifiant, lien et date ; rafraîchissable par une commande |
| X2 | Démarches déposables | Casier judiciaire (PS00373), acte de naissance sécurisé (PS00393), certificat d'identification personnelle (PS00392), authentification de diplôme (PS00254). Formulaire, pièces et frais conformes à la fiche, administration destinataire, règle d'instruction |
| X3 | Dossiers | Création, statut, étapes, cloisonnement par administration et par usager |
| X4 | Paiement simulé | Une fois par dossier, avec une référence de simulation |
| X5 | Décisions | Prise en charge, complément demandé, complément reçu, approbation, rejet |
| X6 | Documents délivrés | PDF généré, marqué simulation |
| X7 | Annuaire | Administrations (connectées ou non), agents, rôles, affectations, profils, rattachés aux identifiants Keycloak |
| X8 | Indicateurs | Chiffres par administration |

## 10. Hors périmètre du 6 novembre

Vrais paiements, vraie connexion ANIP ou portail, circuit à plusieurs administrations, langues fon et yoruba, lecture ou OCR des pièces, antivirus.
