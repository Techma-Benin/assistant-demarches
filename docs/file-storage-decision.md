# Décision du 28 octobre 2026 : stockage de pièces sans antivirus

Décision demandée par le responsable du projet : retirer le scan antivirus obligatoire et toute dépendance ClamAV. Le service conserve des pièces privées sous références opaques pour préparer les démarches ; il n'interprète ni n'exécute les fichiers. Aucun OCR, aperçu, extraction d'archive, détection de fraude ou validation administrative du contenu n'est fourni. L'antivirus n'est pas une fonction du périmètre retenu ; aucune protection antivirus n'est revendiquée.

Après un dépôt réussi, la pièce est immédiatement utilisable par son propriétaire. Restent obligatoires : authentification, contrôle de propriété, identifiants opaques, stockage privé sans URL publique, taille maximale de 10 Mio, liste des types MIME déclarés autorisés, idempotence et expiration 24 heures avec purge par le worker. Le MIME déclaré n'est pas une validation du contenu. Les octets bruts ne sont pas transmis au modèle. Chaque service administratif destinataire reste responsable de ses propres contrôles ; leur présence n'est pas présumée ici.

## Évolution des contrats internes v1

Le champ `File.scanStatus` est supprimé du schéma partagé, des OpenAPI, des types et des fixtures. Ses anciennes valeurs `pending`, `clean`, `rejected` n'ont plus de signification. L'outil `documents.verify` vérifie uniquement la disponibilité/propriété/péremption de la référence ; il ne retourne plus `pending` et `valid` ne certifie pas le contenu.

Cette modification est incompatible avec un client exigeant `scanStatus` : déployer ensemble Backend, Tooling et clients mis à jour, puis régénérer leurs types. Les identifiants de fichiers et les autres champs sont conservés. La migration SQL `006_remove_file_scan.sql` retire l'ancien champ des métadonnées persistées et des réponses d'upload mises en cache pour l'idempotence ; les fichiers existants restent utilisables s'ils appartiennent au bon usager et ne sont pas expirés, quel que soit leur ancien état de scan. Les volumes ClamAV préexistants ne sont pas supprimés automatiquement.

Si le périmètre évolue vers l'interprétation des pièces ou si un destinataire impose un contrôle spécifique, réévaluer cette décision explicitement. Les fixtures d'identité et de modèle de `dev:integration` restent des dépendances de test ; il n'existe plus de scanner, réel ou simulé, dans ce parcours.
