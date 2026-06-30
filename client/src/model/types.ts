// Il modello dati ora vive in `@hexjourney/shared` (unica fonte di verità,
// condivisa con il Worker). Questo file resta come punto di import storico
// (`@/model/types`) e ri-esporta tutto dal pacchetto condiviso.

export * from '@hexjourney/shared/model'
