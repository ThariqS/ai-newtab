/**
 * Français. Typographie : espace insécable (U+00A0) avant « : » et à
 * l’intérieur des guillemets, espace fine insécable (U+202F) avant « ; ! ? ».
 */
import type { Translation } from "..";

export default {
  // ---- extension ------------------------------------------------------------
  "manifest.name": "Page d’accueil IA",
  "manifest.description": "Une page Nouvel onglet qu’un agent reconstruit chaque jour à partir de ce que vous consultez vraiment.",
  "app.title": "Votre page d’accueil",
  "app.loading": "Chargement…",

  // ---- commun ---------------------------------------------------------------
  "common.cancel": "Annuler",
  "common.dismiss": "Fermer",
  "common.signOut": "Se déconnecter",
  "common.settings": "Paramètres",

  // ---- premier écran : choisir et connecter un moteur --------------------------
  "setup.title": "Choisissez qui rédige votre page d’accueil",
  "setup.intro":
    "Chaque génération est une exécution de l’agent. Choisissez le moteur, puis connectez-le. Vous pourrez en changer plus tard dans les Paramètres.",
  "setup.claude.hint": "Clé API Anthropic, facturée à chaque génération",
  "setup.openai.hint": "Votre forfait ChatGPT, ou une clé API",
  "setup.openai.plan": "Utiliser mon forfait ChatGPT (Se connecter avec ChatGPT)",
  "setup.openai.apiKey": "Utiliser une clé API OpenAI",

  "apiKey.anthropic.title": "Connectez votre clé API Anthropic",
  "apiKey.anthropic.body":
    "L’agent s’exécute dans cette extension et communique directement avec l’API Anthropic. Votre clé est stockée dans <code>chrome.storage.local</code> sur cet ordinateur et n’est jamais envoyée ailleurs. Les clés s’obtiennent sur console.anthropic.com.",
  "apiKey.openai.title": "Connectez votre clé API OpenAI",
  "apiKey.openai.body":
    "L’agent s’exécute dans cette extension et communique directement avec l’API OpenAI. Votre clé est stockée dans <code>chrome.storage.local</code> sur cet ordinateur et n’est jamais envoyée ailleurs. Les clés s’obtiennent sur platform.openai.com.",
  "apiKey.save": "Enregistrer la clé",

  "signIn.title": "Se connecter avec ChatGPT",
  "signIn.body":
    "L’agent s’exécute dans cette extension et communique avec l’API OpenAI grâce à votre forfait ChatGPT (Plus ou Pro), via « Se connecter avec ChatGPT ». Aucune clé API n’est nécessaire. Vos jetons sont stockés dans <code>chrome.storage.local</code> sur cet ordinateur et ne sont jamais envoyés ailleurs.",
  "signIn.howItWorks":
    "Un onglet ChatGPT s’ouvre pour vous connecter et approuver cette application. Quand il vous renvoie ici, cette page récupère la connexion automatiquement et l’onglet se ferme de lui-même.",
  "signIn.waiting": "En attente de ChatGPT… terminez la connexion dans l’onglet qui s’est ouvert.",
  "signIn.continue": "Continuer avec ChatGPT",
  "signIn.otherAccount": "Utiliser un autre compte ChatGPT",
  "signIn.otherAccountTitle": "Enregistrer cette application avec un autre compte ou espace de travail ChatGPT",

  "planUsage.title": "Autoriser l’utilisation du forfait ChatGPT",
  "planUsage.body":
    "La connexion à ChatGPT est établie, mais cette application n’a pas été autorisée à utiliser votre forfait ChatGPT pour ses requêtes. La création d’une page d’accueil nécessite cette autorisation.",
  "planUsage.bodyAs":
    "La connexion à ChatGPT est établie avec le compte {email}, mais cette application n’a pas été autorisée à utiliser votre forfait ChatGPT pour ses requêtes. La création d’une page d’accueil nécessite cette autorisation.",
  "planUsage.waiting": "En attente de ChatGPT…",
  "planUsage.enable": "Autoriser l’utilisation du forfait ChatGPT",

  // ---- pas encore de page d’accueil --------------------------------------------
  "home.title": "Créez votre page d’accueil",
  "home.intro":
    "L’agent lit votre historique de navigation, ouvre les pages que vous suivez vraiment et rédige une page d’accueil à partir de ce qu’il y trouve aujourd’hui.",
  "home.build": "Créer la page d’aujourd’hui",
  "home.resume": "Reprendre la génération interrompue",

  // ---- boutons au-dessus de la page d’accueil -----------------------------------
  "toolbar.building": "Génération… {step}/{total}",
  "toolbar.viewProgress": "Voir la progression",
  "toolbar.rebuild": "Régénérer",
  "toolbar.rebuildNow": "Régénérer maintenant",
  "toolbar.customize": "Personnaliser la page d’accueil",

  // ---- progression ------------------------------------------------------------
  "progress.title": "Création de votre page d’accueil",
  "progress.step.prepare": "Préparation de l’agent",
  "progress.step.history": "Lecture de votre historique",
  "progress.step.pages": "Ouverture des pages dans votre navigateur",
  "progress.step.analyze": "Analyse des pages",
  "progress.step.write": "Rédaction de votre page d’accueil",
  "progress.back": "Retour à la page d’accueil",
  "progress.agent": "Agent",
  "progress.warmingUp": "Mise en route — lecture de ce que vous avez consulté…",
  "progress.log": "Journal d’activité",
  "progress.days": { one: "le dernier jour", other: "les {count} derniers jours" },
  "progress.pages": { one: "{count} page", other: "{count} pages" },
  "progress.batchSubmitting": "envoi dans la file de traitement par lots",
  "progress.batchWaiting": "en attente dans la file de traitement par lots · {duration}",
  "duration.seconds": "{count} s",
  "duration.minutes": "{count} min",
  "duration.hours": "{hours} h {minutes} min",

  // ---- échecs -----------------------------------------------------------------
  "error.buildFailed": "La génération a échoué.",
  "error.retry": "Réessayer",
  "error.activityLog": { one: "Journal d’activité ({count} ligne)", other: "Journal d’activité ({count} lignes)" },
  "error.noAnthropicKey": "Aucune clé API Anthropic trouvée. Ajoutez votre clé et réessayez.",
  "error.noOpenAIKey": "Aucune clé API OpenAI trouvée. Ajoutez votre clé et réessayez.",
  "error.notSignedIn":
    "Aucune connexion à ChatGPT, ou l’utilisation du forfait ChatGPT n’a pas été autorisée. Connectez-vous et réessayez.",
  "error.cancelled": "Génération annulée.",
  "error.notificationTitle": "La génération de la page d’accueil a échoué",

  // ---- limite d’utilisation de ChatGPT --------------------------------------------
  "notice.title": "Limite d’utilisation de ChatGPT atteinte",
  "notice.titleAt": "Limite d’utilisation de ChatGPT atteinte à {time}",
  "notice.titleOn": "Limite d’utilisation de ChatGPT atteinte le {date}",
  "notice.banner":
    "Voici votre dernière page d’accueil ; la prochaine sera créée dès que l’allocation de votre forfait pour les applications sera renouvelée.",
  "notice.panel":
    "L’allocation de votre forfait ChatGPT pour les applications comme celle-ci est épuisée pour le moment, donc aucune page d’accueil n’a été créée. Ce n’est pas une panne : l’allocation se renouvelle d’elle-même. Vérifiez quand sur ChatGPT, ou utilisez une clé API en attendant.",
  "notice.panelFooter":
    "Une clé API est facturée à chaque génération sur votre compte API OpenAI. Vous pourrez revenir à votre forfait ChatGPT dans les Paramètres.",
  "notice.seeUsage": "Voir l’utilisation sur ChatGPT",
  "notice.buildWithKey": "Créer avec ma clé API OpenAI",
  "notice.useKey": "Utiliser une clé API OpenAI",
  "notice.tryAgain": "Réessayer",

  // ---- paramètres -------------------------------------------------------------
  "settings.title": "Personnaliser votre page d’accueil",
  "settings.instructions.help": "Des consignes permanentes, appliquées à chaque génération.",
  "settings.instructions.placeholder":
    "p. ex. « Privilégie l’actualité tech et les versions de Rust », « Affiche toujours en premier les PR GitHub non lues »",
  "settings.blocked.label": "Sites que l’agent ne lit jamais",
  "settings.blocked.help": "Un par ligne. Les sous-domaines sont inclus. Utilisez *.example.com comme joker.",
  "settings.language.label": "Langue",
  "settings.language.auto": "Celle du navigateur ({language})",
  "settings.language.help":
    "S’applique tout de suite aux écrans de l’extension. La page d’accueil elle-même est rédigée par l’agent : pour l’obtenir dans une langue précise, demandez-le dans les consignes ci-dessus.",
  "settings.look.label": "Apparence",
  "settings.look.agent": "Telle que l’agent l’a construite",
  "settings.look.help":
    "Une apparence rhabille la page instantanément : la typographie, la palette et les filets changent, les articles restent. Les pages créées avant cette version la suivent à partir de leur prochaine génération.",
  "settings.links.label": "Ouvrir les liens dans",
  "settings.links.newTab": "un nouvel onglet",
  "settings.links.sameTab": "cet onglet",
  "settings.links.help": "Cmd/Ctrl-clic et le bouton du milieu ouvrent toujours un onglet en arrière-plan.",
  "settings.engine.label": "Moteur",
  "settings.model.label": "Modèle",
  "settings.model.none": "Aucun modèle proposé",
  "settings.model.refresh": "Récupérer les modèles offerts par ces identifiants",
  "settings.model.help":
    "Les modèles offerts par vos identifiants, dans l’ordre d’OpenAI. Le nouveau modèle s’applique dès la prochaine génération.",
  "settings.batch.label": "Utiliser l’API Message Batches : moitié prix, plus lent",
  "settings.batch.on":
    "Chaque étape de la génération attend dans la file de traitement par lots d’Anthropic, en général quelques minutes, au plus 24 heures. La génération se poursuit en arrière-plan et la page d’accueil apparaît une fois terminée.",
  "settings.batch.off":
    "Désactivé : les générations s’exécutent dans une session Managed Agents au prix standard, en quelques minutes.",
  "settings.key.anthropic": "Clé API Anthropic : <b>{status}</b>",
  "settings.key.openai": "Clé API OpenAI : <b>{status}</b>",
  "settings.key.saved": "enregistrée",
  "settings.key.missing": "absente",
  "settings.key.change": "Changer de clé",
  "settings.key.add": "Ajouter une clé",
  "settings.openai.plan": "Forfait ChatGPT",
  "settings.openai.apiKey": "Clé API",
  "settings.chatgpt.account": "Compte ChatGPT : <b>{account}</b>",
  "settings.chatgpt.signedIn": "connecté",
  "settings.chatgpt.notSignedIn": "non connecté",
  "settings.chatgpt.noPlanUsage": "(utilisation du forfait non autorisée)",
  "settings.chatgpt.switch": "Changer de compte",
  "settings.chatgpt.switchTitle":
    "Se déconnecter et oublier l’enregistrement de cette application, pour que la prochaine connexion puisse utiliser un autre compte",
  "settings.chatgpt.usage":
    "L’utilisation est décomptée de votre forfait ChatGPT. Consultez-la sur <link>chatgpt.com/settings/usage</link>.",
  "settings.auto.label": "Régénérer automatiquement chaque matin",
  "settings.auto.help":
    "Si l’option est activée, l’extension crée une édition du matin par jour en arrière-plan (la première fois que Chrome est ouvert entre 5 h et midi) : votre prochain onglet en affiche une toute fraîche (avec votre clé ou votre forfait).",
  "settings.save": "Enregistrer et régénérer",

  "engine.claude": "Claude (clé API Anthropic)",
  "engine.openai": "OpenAI (forfait ChatGPT ou clé API)",

  "look.metropolitan": "Manchette en gothique, titres à empattements, noir sur blanc, un bleu discret pour les liens.",
  "look.ledger": "Grand format financier dense : manchette Didone en petites capitales, doubles filets fins, accent bleu marine.",
  "look.capital":
    "Manchette en gothique au-dessus de titres en linéales grasses et d’un texte à empattements, accent ardoise, filets marqués.",
  "look.nationwide": "Style vif tout en linéales : bandeau de manchette bleu, rubriques codées par couleur, espaces blancs généreux.",
  "look.boreal": "Papier crème, manchette massive en elzévir, accent rouge profond, empattements élégants partout.",

  // ---- bouton du thème --------------------------------------------------------
  "theme.system": "Thème : suit le système",
  "theme.dark": "Thème : sombre",
  "theme.light": "Thème : clair",
  "theme.to.system": "suivre le système",
  "theme.to.dark": "passer au sombre",
  "theme.to.light": "passer au clair",
  "theme.title": "{current} — cliquer pour {next}",
  "theme.label": "{current}. Cliquer pour {next}.",
} satisfies Translation;
