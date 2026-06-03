/* ==========================================================================
   DONNÉES STATIQUES & BIBLIOTHÈQUE DE PRÉCONISATIONS
   ========================================================================== */

// Configuration en arrière-plan (IA Gemini et Envoi de mails)
const GEMINI_API_KEY = 'AQ.Ab8RN6Ku4gDM_MSl6TjLV-t2BJ7Q8ouyptt_dXz4ssRolhstZg';
const SMTP_SECURE_TOKEN = 'VOTRE_TOKEN_SMTPJS'; // REMPLACEZ PAR VOTRE SECURE TOKEN SMTPJS OBTENU SUR SMTPJS.COM
const SENDER_EMAIL = 'fabrice.mauger@orange.fr';
const BCC_EMAIL = 'fabrice.mauger@orange.fr';
const INSTAGRAM_URL = 'https://www.instagram.com/batipercheron';

// Structure de départ minimaliste - l'IA génère la structure complète lors de la rédaction
const DEFAULT_BLOCKS = [
    {
        id: 'intro',
        title: 'OBJET DE LA VISITE',
        status: 'empty',
        content: ''
    },
    {
        id: 'conclusion',
        title: 'CONCLUSION',
        status: 'empty',
        content: ''
    }
];

// Utilitaire pour générer un identifiant unique de bloc
function generateBlockId() {
    return 'bloc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

/* ==========================================================================
   GESTION DE L'ÉTAT DE L'APPLICATION (STATE)
   ========================================================================== */

let appState = {
    projects: {},            // Tous les projets stockés localement { id: project }
    currentProjectId: null,  // ID du projet en cours d'édition
    activeTab: 'edit',       // Onglet actif : 'edit' ou 'vocal'
    activeBlockId: 'intro',  // Bloc actif dans l'éditeur
    geminiApiKey: ''         // Clé API Google Gemini
};

// Modèle d'un projet par défaut
function createNewProjectData(name = 'Nouveau Projet') {
    return {
        id: 'proj_' + Date.now(),
        clientName: '',
        clientAddress: '',
        visitAddress: '',
        visitDate: new Date().toISOString().split('T')[0],
        visitType: 'achat', // 'achat' ou 'travaux'
        consultantName: 'Fabrice Mauger - EURL BATI PERCHERON',
        transcription: '',
        blocks: JSON.parse(JSON.stringify(DEFAULT_BLOCKS)) // Copie profonde
    };
}

/* ==========================================================================
   INITIALISATION ET GESTION DES EVENEMENTS
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    loadProjectsFromLocalStorage();
    
    // Si aucun projet n'existe, on en crée un par défaut
    if (Object.keys(appState.projects).length === 0) {
        const defaultProj = createNewProjectData('Nouveau Projet');
        appState.projects[defaultProj.id] = defaultProj;
        appState.currentProjectId = defaultProj.id;
        saveProjectsToLocalStorage();
    } else if (!appState.currentProjectId) {
        // Sinon on prend le premier
        appState.currentProjectId = Object.keys(appState.projects)[0];
    }

    setupEventListeners();
    renderSidebarProjects();
    renderBlockList();
    
    // Charger la clé API Gemini en arrière-plan
    appState.geminiApiKey = GEMINI_API_KEY;

    loadCurrentProjectIntoUI();
    showToast('Application prête (historique des comptes rendus chargé)', 'info');
}

function loadProjectsFromLocalStorage() {
    try {
        const stored = localStorage.getItem('batipercheron_projects');
        if (stored) {
            appState.projects = JSON.parse(stored);
            
            // Migration : Mettre à jour l'ancien conseiller, nettoyer les esperluettes (&) et fusionner observations/préconisations
            for (let id in appState.projects) {
                let proj = appState.projects[id];
                if (!proj.consultantName || proj.consultantName === 'EURL BATI PERCHERON' || proj.consultantName.trim() === '') {
                    proj.consultantName = 'Fabrice Mauger - EURL BATI PERCHERON';
                }
                if (proj.blocks) {
                    proj.blocks.forEach(b => {
                        if (b.title && b.title.includes(' & ')) {
                            b.title = b.title.replace(/ & /g, ' et ');
                        }
                        // Fusionner observations et préconisations si nécessaire
                        if (b.content === undefined) {
                            const obs = b.observations || '';
                            const preco = b.preconisations || '';
                            b.content = (obs + (obs && preco ? '\n\n' : '') + preco).trim();
                            delete b.observations;
                            delete b.preconisations;
                        }
                    });
                }
            }
        }
        const activeId = localStorage.getItem('batipercheron_active_id');
        if (activeId && appState.projects[activeId]) {
            appState.currentProjectId = activeId;
        }
    } catch (e) {
        console.error('Erreur lors de la lecture du LocalStorage', e);
        showToast('Erreur lors du chargement des sauvegardes locales.', 'error');
    }
}

function saveProjectsToLocalStorage() {
    try {
        localStorage.setItem('batipercheron_projects', JSON.stringify(appState.projects));
        if (appState.currentProjectId) {
            localStorage.setItem('batipercheron_active_id', appState.currentProjectId);
        }
    } catch (e) {
        console.error('Erreur lors de l\'écriture dans le LocalStorage', e);
    }
}

function getActiveProject() {
    return appState.projects[appState.currentProjectId];
}

/* ==========================================================================
   ÉCOUTEURS D'ÉVÉNEMENTS (EVENT LISTENERS)
   ========================================================================== */

function setupEventListeners() {
    // Actions globales en en-tête
    document.getElementById('btn-new-project').addEventListener('click', handleNewProject);
    document.getElementById('btn-export-json').addEventListener('click', handleExportJSON);
    document.getElementById('btn-import-trigger').addEventListener('click', () => {
        document.getElementById('file-import-input').click();
    });
    document.getElementById('file-import-input').addEventListener('change', handleImportJSON);
    document.getElementById('btn-print').addEventListener('click', () => window.print());
    document.getElementById('btn-open-projects-list').addEventListener('click', showProjectsModal);

    // Métadonnées (Changements en direct)
    const metaIds = ['meta-client-name', 'meta-client-email', 'meta-visit-address', 'meta-visit-date', 'meta-consultant'];
    metaIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', handleMetadataChange);
        }
    });

    // Onglets de la zone de travail
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabName = btn.getAttribute('data-tab');
            switchTab(tabName);
        });
    });

    // Zone de transcription
    const transTextarea = document.getElementById('transcription-textarea');
    transTextarea.addEventListener('input', (e) => {
        const proj = getActiveProject();
        if (proj) {
            proj.transcription = e.target.value;
            saveProjectsToLocalStorage();
            updateLivePreview();
        }
    });



    // Éditeur de bloc : champs de texte
    const contentTextarea = document.getElementById('editor-content');
    const blockStatusSelect = document.getElementById('editor-block-status');

    if (contentTextarea) {
        contentTextarea.addEventListener('input', (e) => {
            updateActiveBlockData('content', e.target.value);
        });
    }

    blockStatusSelect.addEventListener('change', (e) => {
        updateActiveBlockData('status', e.target.value);
        renderBlockList(); // Mettre à jour les couleurs des badges dans la barre de gauche
    });

    // Boutons de validation de la suggestion IA
    const btnAcceptIa = document.getElementById('btn-accept-ia-suggestion');
    const btnRejectIa = document.getElementById('btn-reject-ia-suggestion');
    const suggestionContainer = document.getElementById('ia-suggestion-container');
    const suggestionTextarea = document.getElementById('editor-ia-suggestion');

    if (btnAcceptIa) {
        btnAcceptIa.addEventListener('click', () => {
            if (suggestionTextarea && contentTextarea) {
                const textToApply = suggestionTextarea.value;
                contentTextarea.value = textToApply;
                updateActiveBlockData('content', textToApply);
                
                // Masquer la suggestion
                if (suggestionContainer) suggestionContainer.style.display = 'none';
                suggestionTextarea.value = '';
                showToast("Modification IA appliquée !", "success");
            }
        });
    }

    if (btnRejectIa) {
        btnRejectIa.addEventListener('click', () => {
            if (suggestionContainer && suggestionTextarea) {
                suggestionContainer.style.display = 'none';
                suggestionTextarea.value = '';
                showToast("Proposition IA ignorée", "info");
            }
        });
    }

    // Ajouter un bloc personnalisé
    document.getElementById('btn-add-block').addEventListener('click', handleAddBlock);

    // Fenêtre Modale (Fermeture)
    document.querySelectorAll('.modal-close, .btn-close-modal').forEach(btn => {
        btn.addEventListener('click', closeModal);
    });

    // Boutons de dictée vocale microphone pour modification par IA
    const micConfigs = [
        { btnId: 'btn-mic-content', txtId: 'editor-content' },
        { btnId: 'btn-mic-guidelines', txtId: 'ai-guidelines' }
    ];

    micConfigs.forEach(cfg => {
        const btn = document.getElementById(cfg.btnId);
        if (btn) {
            btn.addEventListener('click', () => {
                toggleSpeechRecognition(cfg.btnId, cfg.txtId);
            });
        }
    });

    // Bouton terminer sur le bandeau de dictée vocale en direct
    const stopVoiceBtn = document.getElementById('btn-stop-voice-dictation');
    if (stopVoiceBtn) {
        stopVoiceBtn.addEventListener('click', () => {
            if (recognition && activeMicButton) {
                recognition.stop();
            }
        });
    }

    // Bouton d'importation de fichier de transcription (Word/Txt)
    const importTrigger = document.getElementById('btn-import-transcription-trigger');
    const importInput = document.getElementById('transcription-file-input');
    
    if (importTrigger && importInput) {
        importTrigger.addEventListener('click', () => {
            importInput.click();
        });
        importInput.addEventListener('change', handleTranscriptionFileSelect);
    }

    // Bouton d'enregistrement de la clé API Gemini
    const btnSaveKey = document.getElementById('btn-save-api-key');
    if (btnSaveKey) {
        btnSaveKey.addEventListener('click', () => {
            const key = document.getElementById('gemini-api-key').value.trim();
            appState.geminiApiKey = key;
            localStorage.setItem('batipercheron_gemini_api_key', key);
            showToast("Clé API Gemini enregistrée localement !", "success");
        });
    }

    // Bouton de rédaction automatique par IA (Gemini)
    const btnAiGenerate = document.getElementById('btn-ai-generate');
    if (btnAiGenerate) {
        btnAiGenerate.addEventListener('click', handleAIGenerate);
    }

    // Bouton d'envoi d'e-mail au client
    const btnEmailClient = document.getElementById('btn-email-client');
    if (btnEmailClient) {
        btnEmailClient.addEventListener('click', handleEmailClient);
    }

    // Bouton d'envoi direct d'e-mail
    const btnSendEmail = document.getElementById('btn-email-modal-send');
    if (btnSendEmail) {
        btnSendEmail.addEventListener('click', handleDirectEmailSend);
    }
}

/* ==========================================================================
   LOGIQUE MÉTIER & ACTIONS
   ========================================================================== */

// Créer un nouveau projet
function handleNewProject() {
    if (confirm('Voulez-vous créer un nouveau compte rendu ? Le projet en cours sera conservé dans l\'historique local.')) {
        const newProj = createNewProjectData('Nouveau Compte Rendu');
        appState.projects[newProj.id] = newProj;
        appState.currentProjectId = newProj.id;
        appState.activeBlockId = 'intro';
        
        saveProjectsToLocalStorage();
        loadCurrentProjectIntoUI();
        renderSidebarProjects();
        renderBlockList();
        
        switchTab('edit');
        showToast('Nouveau projet créé', 'success');
    }
}

// Mise à jour des métadonnées
function handleMetadataChange(e) {
    const proj = getActiveProject();
    if (!proj) return;

    const fieldMap = {
        'meta-client-name': 'clientName',
        'meta-client-email': 'clientEmail',
        'meta-visit-address': 'visitAddress',
        'meta-visit-date': 'visitDate',
        'meta-consultant': 'consultantName'
    };

    const stateKey = fieldMap[e.target.id];
    if (stateKey) {
        proj[stateKey] = e.target.value;
        saveProjectsToLocalStorage();
        updateLivePreview();
    }
}

// Commuter d'onglet (Éditeur vs Note vocale)
function switchTab(tabName) {
    appState.activeTab = tabName;
    
    // Boutons
    document.querySelectorAll('.workspace-tabs .tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Panneaux de contenu
    document.querySelectorAll('.tab-content-container .tab-pane').forEach(pane => {
        if (pane.getAttribute('id') === `tab-pane-${tabName}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });
}

// Sélectionner un bloc dans la barre latérale pour l'éditer
function selectBlock(blockId) {
    appState.activeBlockId = blockId;
    
    // Classe active dans la liste
    document.querySelectorAll('.block-list .block-item').forEach(item => {
        if (item.getAttribute('data-block-id') === blockId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    const proj = getActiveProject();
    const block = proj.blocks.find(b => b.id === blockId);
    
    if (block) {
        // Charger dans les formulaires de l'éditeur
        document.getElementById('active-block-title-display').innerText = block.title;
        document.getElementById('editor-content').value = block.content || '';
        document.getElementById('editor-block-status').value = block.status;

        // Masquer la suggestion IA en attente d'un autre bloc
        const suggestionContainer = document.getElementById('ia-suggestion-container');
        const suggestionTextarea = document.getElementById('editor-ia-suggestion');
        if (suggestionContainer) suggestionContainer.style.display = 'none';
        if (suggestionTextarea) suggestionTextarea.value = '';
    }
}

// Mettre à jour le texte du bloc actif
function updateActiveBlockData(key, value) {
    const proj = getActiveProject();
    if (!proj) return;

    const block = proj.blocks.find(b => b.id === appState.activeBlockId);
    if (block) {
        block[key] = value;
        
        // Si l'utilisateur a écrit du texte et que le bloc était "vide", on le passe en "En cours"
        if (key !== 'status' && block.status === 'empty' && value.trim() !== '') {
            block.status = 'progress';
            document.getElementById('editor-block-status').value = 'progress';
            renderBlockList();
        }

        saveProjectsToLocalStorage();
        updateLivePreview();
    }
}

// Ajouter un bloc personnalisé
function handleAddBlock() {
    const title = prompt('Saisissez le titre du nouveau bloc (ex: Bâtisse 2, Grange, Piscine...) :');
    if (!title || title.trim() === '') return;

    const proj = getActiveProject();
    if (!proj) return;

    const newId = generateBlockId();
    const newBlock = {
        id: newId,
        title: title.trim(),
        status: 'empty',
        content: ''
    };

    // Insérer avant le dernier bloc (Conclusion) s'il existe, sinon en fin de liste
    const conclusionIndex = proj.blocks.findLastIndex(b => b.title.toLowerCase().includes('conclusion'));
    if (conclusionIndex > 0) {
        proj.blocks.splice(conclusionIndex, 0, newBlock);
    } else {
        proj.blocks.push(newBlock);
    }

    saveProjectsToLocalStorage();
    renderBlockList();
    selectBlock(newId);
    updateLivePreview();
    showToast(`Bloc "${title.trim()}" ajouté`, 'success');
}

// Renommer un bloc existant
function renameBlock(blockId, e) {
    if (e) e.stopPropagation();

    const proj = getActiveProject();
    if (!proj) return;
    const block = proj.blocks.find(b => b.id === blockId);
    if (!block) return;

    const newTitle = prompt(`Renommer le bloc :`, block.title);
    if (!newTitle || newTitle.trim() === '' || newTitle.trim() === block.title) return;

    block.title = newTitle.trim();

    // Mettre à jour l'en-tête de l'éditeur si c'est le bloc actif
    if (appState.activeBlockId === blockId) {
        const display = document.getElementById('active-block-title-display');
        if (display) display.innerText = block.title;
    }

    saveProjectsToLocalStorage();
    renderBlockList();
    updateLivePreview();
    showToast(`Bloc renommé en « ${block.title} »`, 'success');
}

// Supprimer un bloc
function deleteBlock(blockId, e) {
    if (e) e.stopPropagation(); // Éviter de sélectionner le bloc pendant le clic sur supprimer

    const proj = getActiveProject();
    const blockIndex = proj.blocks.findIndex(b => b.id === blockId);
    
    if (blockIndex === -1) return;
    const blockTitle = proj.blocks[blockIndex].title;

    if (confirm(`Voulez-vous vraiment supprimer le bloc "${blockTitle}" ? Toutes les données qu'il contient seront perdues.`)) {
        proj.blocks.splice(blockIndex, 1);
        saveProjectsToLocalStorage();
        
        renderBlockList();
        
        // Si on a supprimé le bloc actif, on sélectionne le premier bloc restant ou on vide l'éditeur
        if (appState.activeBlockId === blockId) {
            if (proj.blocks.length > 0) {
                selectBlock(proj.blocks[0].id);
            } else {
                appState.activeBlockId = null;
                document.getElementById('active-block-title-display').innerText = 'Aucun bloc';
                document.getElementById('editor-content').value = '';
                document.getElementById('editor-block-status').value = 'empty';
            }
        }
        
        updateLivePreview();
        showToast(`Bloc "${blockTitle}" supprimé`, 'info');
    }
}

// Ordonner les blocs (monter/descendre) avec rebouclage (wrap around)
function moveBlock(blockId, direction, e) {
    if (e) e.stopPropagation();

    const proj = getActiveProject();
    const index = proj.blocks.findIndex(b => b.id === blockId);
    if (index === -1) return;

    if (proj.blocks.length <= 1) return; // Rien à déplacer

    let targetIndex;
    if (direction === 'up') {
        targetIndex = index - 1;
        if (targetIndex < 0) {
            targetIndex = proj.blocks.length - 1;
        }
    } else {
        targetIndex = index + 1;
        if (targetIndex >= proj.blocks.length) {
            targetIndex = 0;
        }
    }

    // Échange des éléments dans le tableau
    const temp = proj.blocks[index];
    proj.blocks[index] = proj.blocks[targetIndex];
    proj.blocks[targetIndex] = temp;

    saveProjectsToLocalStorage();
    renderBlockList();
    updateLivePreview();
}

/* ==========================================================================
   SYSTÈME DE TRANSCRIPTION & DISPATCHER (TAB 1)
   ========================================================================== */



/* ==========================================================================
   CHARGEMENT ET RENDU DE L'INTERFACE UI
   ========================================================================== */

function loadCurrentProjectIntoUI() {
    const proj = getActiveProject();
    if (!proj) return;

    // Charger les métadonnées dans les inputs de gauche
    document.getElementById('meta-client-name').value = proj.clientName || '';
    if (document.getElementById('meta-client-email')) {
        document.getElementById('meta-client-email').value = proj.clientEmail || '';
    }
    document.getElementById('meta-visit-address').value = proj.visitAddress || '';
    document.getElementById('meta-visit-date').value = proj.visitDate || '';
    document.getElementById('meta-consultant').value = proj.consultantName || 'Fabrice Mauger - EURL BATI PERCHERON';

    // Charger la transcription dans la zone de texte
    document.getElementById('transcription-textarea').value = proj.transcription || '';

    // Sélectionner le premier bloc par défaut
    if (proj.blocks && proj.blocks.length > 0) {
        // S'assurer que le bloc actif existe toujours, sinon prendre le premier
        const activeExists = proj.blocks.some(b => b.id === appState.activeBlockId);
        if (!activeExists) {
            appState.activeBlockId = proj.blocks[0].id;
        }
        selectBlock(appState.activeBlockId);
    }



    // Mettre à jour la prévisualisation finale A4
    updateLivePreview();
}

// Rendre la liste des blocs dans la barre latérale gauche (Sommaire)
function renderBlockList() {
    const proj = getActiveProject();
    const listContainer = document.getElementById('app-block-list');
    listContainer.innerHTML = '';

    if (!proj || !proj.blocks) return;

    proj.blocks.forEach((block, index) => {
        const isActive = block.id === appState.activeBlockId;
        
        // Traduction statut
        let statusClass = 'status-empty';
        let statusLabel = 'Vide';
        if (block.status === 'progress') {
            statusClass = 'status-progress';
            statusLabel = 'En cours';
        } else if (block.status === 'done') {
            statusClass = 'status-done';
            statusLabel = 'Terminé';
        }

        const item = document.createElement('div');
        item.className = `block-item ${isActive ? 'active' : ''}`;
        item.setAttribute('data-block-id', block.id);
        item.addEventListener('click', () => {
            selectBlock(block.id);
            switchTab('edit'); // Rediriger automatiquement vers l'onglet d'édition si on clique sur un bloc
        });

        // Contenu du bloc item
        item.innerHTML = `
            <div class="block-item-info">
                <div class="block-title" title="${block.title}">${block.title}</div>
                <span class="block-status ${statusClass}">${statusLabel}</span>
            </div>
            <div class="block-item-actions">
                <button class="block-item-btn btn-rename-block" title="Renommer">✏️</button>
                <button class="block-item-btn btn-move-up" title="Monter">▲</button>
                <button class="block-item-btn btn-move-down" title="Descendre">▼</button>
                <button class="block-item-btn btn-delete-block" title="Supprimer">✖</button>
            </div>
        `;

        // Événements boutons actions
        item.querySelector('.btn-rename-block').addEventListener('click', (e) => renameBlock(block.id, e));
        item.querySelector('.btn-move-up').addEventListener('click', (e) => moveBlock(block.id, 'up', e));
        item.querySelector('.btn-move-down').addEventListener('click', (e) => moveBlock(block.id, 'down', e));
        item.querySelector('.btn-delete-block').addEventListener('click', (e) => deleteBlock(block.id, e));

        listContainer.appendChild(item);
    });
}



// La bibliothèque de modèles types a été retirée

/* ==========================================================================
   MISE À JOUR DE LA PRÉVISUALISATION DU RAPPORT A4 (PANNEAU DROIT)
   ========================================================================== */

function createPageFooter(pageNum, totalPages) {
    const footer = document.createElement('div');
    footer.className = 'doc-page-footer';
    footer.innerHTML = `
        <div class="doc-footer">
            <span class="doc-footer-page-num" style="margin-left: auto;">Page ${pageNum} / ${totalPages}</span>
        </div>
    `;
    return footer;
}

function updateLivePreview() {
    const proj = getActiveProject();
    const previewContainer = document.getElementById('document-preview-target');

    if (!proj) {
        previewContainer.innerHTML = `
            <div class="preview-empty-message">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                <p>Aucun projet actif. Créez un nouveau projet pour commencer.</p>
            </div>
        `;
        return;
    }

    // Formater la date en français
    let formattedDate = 'Non renseignée';
    if (proj.visitDate) {
        const parts = proj.visitDate.split('-');
        if (parts.length === 3) {
            formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
    }

    // Vider le conteneur d'aperçu
    previewContainer.innerHTML = '';

    // Liste pour suivre les pages créées
    const pages = [];

    function createNewPage() {
        const pageIndex = pages.length + 1;
        
        const pageEl = document.createElement('div');
        pageEl.className = 'document-sheet';
        pageEl.setAttribute('data-page-index', pageIndex);
        
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'doc-page-content-wrapper';
        pageEl.appendChild(contentWrapper);
        
        // Pied de page temporaire pour la mesure
        const tempFooter = createPageFooter(pageIndex, pageIndex);
        pageEl.appendChild(tempFooter);
        
        previewContainer.appendChild(pageEl);
        
        const pageObj = {
            element: pageEl,
            contentWrapper: contentWrapper,
            footer: tempFooter
        };
        pages.push(pageObj);
        return pageObj;
    }

    function isPageOverflowing(pageEl) {
        return pageEl.scrollHeight > pageEl.clientHeight;
    }

    // Créer la première page
    let currentPage = createNewPage();

    // Rendre l'en-tête et la fiche client sur la Page 1
    const headerHtml = `
        <div class="doc-header">
            <img src="logo-horizontal.jpg" class="doc-logo-img" alt="Bati Percheron">
        </div>
        <div class="doc-title-container">
            <h1 class="doc-title">COMPTE RENDU DE VISITE CONSEIL</h1>
        </div>
        <div class="doc-meta-split">
            <div class="doc-meta-left">
                <div class="doc-meta-client-name">${escapeHTML(proj.clientName) || '<i>Client non spécifié</i>'}</div>
                <div class="doc-meta-item">
                    <strong>Date de la visite</strong>
                    <span>${formattedDate}</span>
                </div>
                <div class="doc-meta-item doc-meta-address">
                    <strong>Adresse de la visite</strong>
                    <span class="doc-address-val">${formatAddressHTML(proj.visitAddress)}</span>
                </div>
            </div>
            <div class="doc-meta-right">
                <div class="doc-company-header">Conseil délivré par :</div>
                <div class="doc-company-details">
                    <span class="doc-company-name">Fabrice Mauger</span>
                    <span class="doc-company-brand">EURL BATI PERCHERON</span>
                    <span>LD La Livraise, 61340 Berd'huis</span>
                    <span>Tél : 06 95 30 15 25</span>
                    <span class="doc-company-siret">SIRET 812 199 719 00012</span>
                    <span class="doc-company-url"><a href="https://www.batipercheron.fr" target="_blank">www.batipercheron.fr</a></span>
                    <span class="doc-company-url"><a href="${INSTAGRAM_URL}" target="_blank">Instagram</a></span>
                </div>
            </div>
        </div>
    `;
    currentPage.contentWrapper.innerHTML = headerHtml;

    // Récupérer les blocs de contenu non vides
    const activeBlocks = proj.blocks.filter(block => block.content && block.content.trim().length > 0);

    if (activeBlocks.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.cssText = 'text-align: center; color: var(--color-text-light); font-style: italic; margin: 4rem 0;';
        emptyMsg.innerHTML = 'Aucun contenu rédigé pour le moment. Saisissez du texte dans l\'éditeur de blocs pour le voir s\'afficher ici.';
        currentPage.contentWrapper.appendChild(emptyMsg);
    } else {
        // Parcourir les blocs et les distribuer dynamiquement
        activeBlocks.forEach(block => {
            let sectionEl = document.createElement('div');
            sectionEl.className = 'doc-section';
            sectionEl.innerHTML = `<h3 class="doc-section-title">${escapeHTML(block.title)}</h3>`;
            
            let sectionContent = document.createElement('div');
            sectionContent.className = 'doc-section-content';
            sectionEl.appendChild(sectionContent);
            
            // Ajouter la section sur la page en cours
            currentPage.contentWrapper.appendChild(sectionEl);
            
            if (isPageOverflowing(currentPage.element)) {
                // Si le titre de la section dépasse, on la déplace sur une nouvelle page
                currentPage.contentWrapper.removeChild(sectionEl);
                currentPage = createNewPage();
                currentPage.contentWrapper.appendChild(sectionEl);
            }
            
            // Découper le contenu en paragraphes
            const paragraphs = block.content.split(/\n+/).filter(p => p.trim().length > 0);
            
            paragraphs.forEach(paraText => {
                const paraEl = document.createElement('div');
                paraEl.className = 'doc-section-text';
                paraEl.innerHTML = linkify(escapeHTML(paraText));
                
                // Tenter d'ajouter le paragraphe
                sectionContent.appendChild(paraEl);
                
                if (isPageOverflowing(currentPage.element)) {
                    // Débordement détecté ! On le retire du conteneur courant
                    sectionContent.removeChild(paraEl);
                    
                    // La section est-elle le premier et unique bloc de cette page ?
                    const sectionsOnPage = currentPage.contentWrapper.querySelectorAll('.doc-section');
                    const isSectionFirstOnPage = (sectionsOnPage.length === 1);
                    
                    if (isSectionFirstOnPage) {
                        // Déjà en haut de page, on doit couper
                        const isPageEmpty = (currentPage.contentWrapper.children.length === 1 && sectionContent.children.length === 0);
                        
                        if (isPageEmpty) {
                            // Garder le paragraphe pour éviter une boucle infinie
                            sectionContent.appendChild(paraEl);
                        } else {
                            if (sectionContent.children.length === 0) {
                                // Titre seul, on déplace toute la section
                                currentPage.contentWrapper.removeChild(sectionEl);
                                currentPage = createNewPage();
                                currentPage.contentWrapper.appendChild(sectionEl);
                                sectionContent.appendChild(paraEl);
                            } else {
                                // Plus d'un paragraphe, on coupe la section
                                currentPage = createNewPage();
                                
                                sectionEl = document.createElement('div');
                                sectionEl.className = 'doc-section';
                                
                                sectionContent = document.createElement('div');
                                sectionContent.className = 'doc-section-content';
                                sectionEl.appendChild(sectionContent);
                                
                                currentPage.contentWrapper.appendChild(sectionEl);
                                sectionContent.appendChild(paraEl);
                            }
                        }
                    } else {
                        // Pas en haut de page, on déplace TOUTE la section sur une nouvelle page
                        currentPage.contentWrapper.removeChild(sectionEl);
                        currentPage = createNewPage();
                        
                        currentPage.contentWrapper.appendChild(sectionEl);
                        sectionContent.appendChild(paraEl);
                        
                        // Si elle déborde toujours sur la nouvelle page, on doit la couper
                        if (isPageOverflowing(currentPage.element)) {
                            sectionContent.removeChild(paraEl);
                            currentPage = createNewPage();
                            
                            sectionEl = document.createElement('div');
                            sectionEl.className = 'doc-section';
                            
                            sectionContent = document.createElement('div');
                            sectionContent.className = 'doc-section-content';
                            sectionEl.appendChild(sectionContent);
                            
                            currentPage.contentWrapper.appendChild(sectionEl);
                            sectionContent.appendChild(paraEl);
                        }
                    }
                }
            });
        });
    }

    // Tous les blocs sont placés. Mettre à jour tous les numéros de page avec le nombre total définitif
    const totalPagesCount = pages.length;
    pages.forEach((pageObj, idx) => {
        const pageNum = idx + 1;
        const updatedFooter = createPageFooter(pageNum, totalPagesCount);
        pageObj.element.replaceChild(updatedFooter, pageObj.footer);
        pageObj.footer = updatedFooter;
    });

    // Mettre à jour le badge du nombre de pages dans l'interface
    const badge = document.getElementById('preview-page-count-badge');
    if (badge) {
        badge.innerText = `~ ${totalPagesCount} page${totalPagesCount > 1 ? 's' : ''}`;
    }
}

/* ==========================================================================
   EXPORTATION ET IMPORTATION JSON (SAUVEGARDES PHYSIQUES)
   ========================================================================== */

async function handleExportJSON() {
    const proj = getActiveProject();
    if (!proj) return;

    // Nom de fichier propre basé sur le nom du client et la date
    const clientClean = (proj.clientName || 'SansNom').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `CompteRendu_${clientClean}_${proj.visitDate || 'date'}.json`;

    // Si le navigateur supporte l'écriture directe de fichiers (Chrome / Edge)
    if (window.showSaveFilePicker) {
        try {
            const options = {
                suggestedName: filename,
                types: [{
                    description: 'Fichier de travail Bati Percheron (.json)',
                    accept: {
                        'application/json': ['.json'],
                    },
                }],
            };
            const handle = await window.showSaveFilePicker(options);
            const writable = await handle.createWritable();
            await writable.write(JSON.stringify(proj, null, 4));
            await writable.close();
            showToast('Fichier enregistré avec succès dans OneDrive', 'success');
        } catch (err) {
            // Si l'utilisateur annule, on ne fait rien
            if (err.name !== 'AbortError') {
                console.error("Erreur d'écriture de fichier", err);
                showToast("Échec de l'enregistrement direct. Tentative de téléchargement classique...", "warning");
                fallbackDownload(proj, filename);
            }
        }
    } else {
        // Fallback pour les navigateurs plus anciens ou Firefox
        fallbackDownload(proj, filename);
    }
}

function fallbackDownload(proj, filename) {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(proj, null, 4));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Fichier téléchargé (vérifiez votre dossier Téléchargements)', 'success');
}

function handleImportJSON(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const importedData = JSON.parse(evt.target.result);
            
            // Validation très sommaire du schéma
            if (!importedData.id || !importedData.blocks || !Array.isArray(importedData.blocks)) {
                throw new Error('Format de fichier invalide (propriétés manquantes)');
            }

            // Générer un nouvel ID pour éviter d'écraser un projet s'il s'agit d'un doublon
            // ou écraser s'il a le même id
            const id = importedData.id;
            appState.projects[id] = importedData;
            appState.currentProjectId = id;

            saveProjectsToLocalStorage();
            loadCurrentProjectIntoUI();
            renderSidebarProjects();
            renderBlockList();
            
            switchTab('edit');
            showToast('Projet importé et chargé avec succès !', 'success');

        } catch (err) {
            console.error(err);
            alert('Impossible de charger le fichier. Assurez-vous qu\'il s\'agit d\'un fichier JSON de sauvegarde Bati Percheron valide.');
            showToast('Échec de l\'importation', 'error');
        }
    };
    reader.readAsText(file);
    // Réinitialiser la valeur de l'input file pour permettre d'importer le même fichier à la suite
    e.target.value = '';
}

/* ==========================================================================
   MODALE DE SELECTION DES ANCIENS PROJETS
   ========================================================================== */

function showProjectsModal() {
    const modal = document.getElementById('projects-modal');
    const tbody = document.getElementById('projects-list-tbody');
    tbody.innerHTML = '';

    const sortedProjects = Object.values(appState.projects).sort((a, b) => {
        return new Date(b.visitDate || 0) - new Date(a.visitDate || 0);
    });

    if (sortedProjects.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; font-style:italic;">Aucun projet dans l'historique local.</td></tr>`;
    } else {
        sortedProjects.forEach(proj => {
            const tr = document.createElement('tr');
            
            // Formater date
            let formattedDate = 'Non spécifiée';
            if (proj.visitDate) {
                const parts = proj.visitDate.split('-');
                if (parts.length === 3) formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
            }

            // Nombre de blocs saisis
            const totalBlocks = proj.blocks ? proj.blocks.length : 0;
            const filledBlocks = proj.blocks ? proj.blocks.filter(b => b.status !== 'empty').length : 0;

            const isCurrent = proj.id === appState.currentProjectId;

            tr.innerHTML = `
                <td style="padding:0.75rem; border-bottom:1px solid var(--color-border); font-weight:${isCurrent ? 'bold' : 'normal'};">
                    ${escapeHTML(proj.clientName) || '<i>Client sans nom</i>'} ${isCurrent ? ' (Actif)' : ''}
                </td>
                <td style="padding:0.75rem; border-bottom:1px solid var(--color-border); font-size:0.85rem;">
                    ${formattedDate}
                </td>
                <td style="padding:0.75rem; border-bottom:1px solid var(--color-border); font-size:0.85rem; text-align:center;">
                    ${filledBlocks} / ${totalBlocks}
                </td>
                <td style="padding:0.75rem; border-bottom:1px solid var(--color-border); text-align:right; display:flex; gap:0.25rem; justify-content:flex-end;">
                    <button class="btn btn-outline btn-sm btn-open-project" ${isCurrent ? 'disabled' : ''}>Ouvrir</button>
                    <button class="btn btn-danger btn-sm btn-delete-project" style="padding:0.25rem 0.5rem;">Supprimer</button>
                </td>
            `;

            tr.querySelector('.btn-open-project').addEventListener('click', () => {
                appState.currentProjectId = proj.id;
                saveProjectsToLocalStorage();
                loadCurrentProjectIntoUI();
                renderBlockList();
                closeModal();
                showToast(`Projet chargé : ${proj.clientName || 'Sans nom'}`, 'success');
            });

            tr.querySelector('.btn-delete-project').addEventListener('click', () => {
                if (confirm(`Voulez-vous vraiment supprimer définitivement le projet de "${proj.clientName || 'Client sans nom'}" de l'historique local ?`)) {
                    delete appState.projects[proj.id];
                    
                    // Si on a supprimé le projet courant
                    if (appState.currentProjectId === proj.id) {
                        const remainingIds = Object.keys(appState.projects);
                        if (remainingIds.length > 0) {
                            appState.currentProjectId = remainingIds[0];
                        } else {
                            // On en recrée un vide
                            const defaultProj = createNewProjectData('Nouveau Projet');
                            appState.projects[defaultProj.id] = defaultProj;
                            appState.currentProjectId = defaultProj.id;
                        }
                    }
                    
                    saveProjectsToLocalStorage();
                    loadCurrentProjectIntoUI();
                    renderSidebarProjects();
                    renderBlockList();
                    showProjectsModal(); // Recharger la liste dans la modale
                    showToast('Projet supprimé de l\'historique local', 'info');
                }
            });

            tbody.appendChild(tr);
        });
    }

    modal.classList.add('active');
}

function renderSidebarProjects() {
    // Optionnel : on peut mettre à jour des compteurs globaux de projets dans la sidebar
    const sorted = Object.values(appState.projects);
    const activeProj = getActiveProject();
    if (activeProj) {
        document.getElementById('current-project-sidebar-title').innerText = activeProj.clientName || 'Projet Actif';
    }
}

function closeModal() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

/* ==========================================================================
   UTILITAIRES (UTILITIES)
   ========================================================================== */

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-notification-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✔️';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    // Supprimer après 3.5 secondes
    setTimeout(() => {
        toast.style.animation = 'slideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1) reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

/* ==========================================================================
   INTEGRATION DE LA RECONNAISSANCE VOCALE (WEB SPEECH API)
   ========================================================================== */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let activeMicButton = null;
let activeTextarea = null;
let recordedSpeech = '';

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'fr-FR';

    recognition.onresult = function(event) {
        let interimTranscript = '';
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        
        if (finalTranscript) {
            recordedSpeech += (recordedSpeech ? ' ' : '') + finalTranscript.trim();
        }
        
        // Mettre à jour l'affichage du bandeau en direct
        const dictationTextEl = document.getElementById('voice-dictation-text');
        if (dictationTextEl) {
            let displayText = recordedSpeech;
            if (interimTranscript) {
                displayText += (displayText ? ' ' : '') + interimTranscript.trim();
            }
            dictationTextEl.innerText = displayText || 'Parlez maintenant...';
        }
    };

    recognition.onend = async function() {
        const btn = activeMicButton;
        const txt = activeTextarea;
        const instruction = recordedSpeech.trim();

        // Réinitialiser les états
        activeMicButton = null;
        activeTextarea = null;
        recordedSpeech = '';

        if (btn) {
            btn.classList.remove('recording');
            if (btn.id === 'btn-mic-guidelines') {
                btn.title = "Dicter des consignes de rédaction pour l'IA";
            } else {
                btn.title = "Dicter une consigne de modification ou correction par l'IA";
            }
        }

        // Cacher le bandeau
        const banner = document.getElementById('voice-dictation-banner');
        if (banner) {
            banner.style.display = 'none';
        }

        if (instruction && txt) {
            if (txt.id === 'ai-guidelines') {
                txt.value = (txt.value ? txt.value + ' ' : '') + instruction;
                txt.dispatchEvent(new Event('input'));
                showToast("Consigne de guidage enregistrée !", "success");
            } else {
                showToast("Consigne vocale capturée, traitement par l'IA...", "info");
                await modifyTextWithAI(txt, instruction);
            }
        } else {
            showToast("Écoute vocale arrêtée (aucune instruction détectée)", "info");
        }
    };

    recognition.onerror = function(event) {
        console.error("Erreur de reconnaissance vocale", event);
        if (event.error === 'not-allowed') {
            showToast("Accès au microphone refusé par le navigateur.", "error");
        } else {
            showToast("Erreur lors de l'écoute vocale : " + event.error, "error");
        }
        if (activeMicButton) {
            activeMicButton.classList.remove('recording');
            if (activeMicButton.id === 'btn-mic-guidelines') {
                activeMicButton.title = "Dicter des consignes de rédaction pour l'IA";
            } else {
                activeMicButton.title = "Dicter une consigne de modification ou correction par l'IA";
            }
        }
        activeMicButton = null;
        activeTextarea = null;
        recordedSpeech = '';

        // Cacher le bandeau
        const banner = document.getElementById('voice-dictation-banner');
        if (banner) {
            banner.style.display = 'none';
        }
    };
}

function toggleSpeechRecognition(buttonId, textareaId) {
    if (!SpeechRecognition) {
        showToast("Votre navigateur ne supporte pas la dictée vocale native (essayez Google Chrome ou Edge).", "warning");
        return;
    }

    const button = document.getElementById(buttonId);
    const textarea = document.getElementById(textareaId);

    if (activeMicButton === button) {
        recognition.stop();
    } else {
        if (activeMicButton) {
            recognition.stop();
            setTimeout(() => toggleSpeechRecognition(buttonId, textareaId), 300);
            return;
        }

        activeMicButton = button;
        activeTextarea = textarea;
        recordedSpeech = '';
        button.classList.add('recording');
        
        if (buttonId === 'btn-mic-guidelines') {
            button.title = "Arrêter la dictée de consigne";
        } else {
            button.title = "Arrêter et envoyer la consigne à l'IA";
        }
        
        // Afficher le bandeau de dictée vocale en direct
        const banner = document.getElementById('voice-dictation-banner');
        const dictationTextEl = document.getElementById('voice-dictation-text');
        if (banner) {
            banner.style.display = 'flex';
        }
        if (dictationTextEl) {
            dictationTextEl.innerText = 'Parlez maintenant...';
        }

        try {
            recognition.start();
            if (buttonId === 'btn-mic-guidelines') {
                showToast("Dictez vos consignes pour l'IA (ex : 'insister sur l'humidité du salon')...", "success");
            } else {
                showToast("Dictez votre consigne (ex : 'remplace la date par le 22 avril')...", "success");
            }
        } catch (err) {
            console.error("Échec de démarrage de la reconnaissance vocale", err);
            button.classList.remove('recording');
            button.title = "Dicter une consigne de modification ou correction par l'IA";
            activeMicButton = null;
            activeTextarea = null;
            if (banner) banner.style.display = 'none';
        }
    }
}

/* Fonction pour modifier ou corriger un texte existant avec Gemini selon une consigne vocale */
async function modifyTextWithAI(textarea, instruction) {
    if (!appState.geminiApiKey) {
        showToast("Veuillez d'abord configurer votre clé API Gemini dans la barre latérale pour utiliser l'IA.", "warning");
        return;
    }

    const loader = document.getElementById('ai-loading-overlay');
    const loadingText = loader ? loader.querySelector('.loading-text') : null;
    const loadingSubtext = loader ? loader.querySelector('.loading-subtext') : null;
    
    // Sauvegarder les textes du loader pour les restaurer après
    const oldText = loadingText ? loadingText.innerText : "";
    const oldSubtext = loadingSubtext ? loadingSubtext.innerText : "";

    if (loadingText) loadingText.innerText = "Modification du paragraphe par l'IA...";
    if (loadingSubtext) loadingSubtext.innerText = `Prise en compte de votre consigne : "${instruction}"`;
    if (loader) loader.classList.add('active');

    const currentText = textarea.value.trim();
    const proj = getActiveProject();
    
    const block = proj.blocks.find(b => b.id === appState.activeBlockId);
    const blockTitle = block ? block.title : "ce paragraphe";

    const promptText = `Tu es un conseiller expert en bâtiment, spécialiste bienveillant et constructif de la restauration et de la préservation du patrimoine ancien percheron.
Tu dois modifier ou corriger le texte actuel du bloc "${blockTitle}" en appliquant l'instruction vocale donnée par l'utilisateur.

Voici le texte actuel (qui peut être vide) :
"${currentText}"

Voici la consigne de modification dictée par l'utilisateur :
"${instruction}"

Règles à suivre impérativement :
1. Modifie le texte existant en intégrant la consigne. S'il s'agit d'une correction de date, d'adresse, de technique ou d'un ajout, fais-le proprement.
2. Si le texte actuel est vide, rédige un paragraphe rédigé à partir de la consigne vocale fournie.
3. Conserve un ton professionnel, encourageant, constructif et optimiste quant au potentiel du bâtiment. Évite le ton trop froid, austère, alarmiste ou de "diagnostiqueur" (pas de "je", pas de salutations).
4. Ne réponds QUE par le nouveau texte corrigé. Ne mets aucune phrase d'explication, aucune introduction, aucun commentaire, ni balises markdown. Renvoie directement le texte final.`;

    let updatedText = "";
    let success = false;
    let lastError = null;
    const modelsToTry = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash'];

    for (const modelName of modelsToTry) {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${appState.geminiApiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: promptText
                        }]
                    }]
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
                    updatedText = data.candidates[0].content.parts[0].text.trim();
                    
                    // Nettoyer les balises Markdown si l'IA en a généré par habitude
                    if (updatedText.startsWith("```")) {
                        updatedText = updatedText.replace(/^```[a-zA-Z]*\n?/, "");
                        updatedText = updatedText.replace(/\n?```$/, "");
                    }
                    updatedText = updatedText.trim();
                    success = true;
                    break;
                }
            } else {
                let errorMsg = `${modelName} - HTTP ${response.status}`;
                try {
                    const errData = await response.json();
                    if (errData && errData.error && errData.error.message) {
                        errorMsg += ` - ${errData.error.message}`;
                    }
                } catch (e) {}
                lastError = new Error(errorMsg);
            }
        } catch (err) {
            lastError = err;
        }
    }

    // Retirer le loader
    if (loader) loader.classList.remove('active');
    if (loadingText) loadingText.innerText = oldText;
    if (loadingSubtext) loadingSubtext.innerText = oldSubtext;

    if (success) {
        // Au lieu d'écraser immédiatement, on affiche la suggestion de l'IA
        const suggestionContainer = document.getElementById('ia-suggestion-container');
        const suggestionTextarea = document.getElementById('editor-ia-suggestion');
        if (suggestionContainer && suggestionTextarea) {
            suggestionTextarea.value = cleanContentFormatting(updatedText);
            suggestionContainer.style.display = 'flex';
            // Faire défiler l'éditeur pour afficher la suggestion
            document.querySelector('.editor-body').scrollTop = document.querySelector('.editor-body').scrollHeight;
        }
        showToast("Proposition de l'IA générée !", "success");
    } else {
        console.error("Erreur d'édition IA", lastError);
        alert(`Impossible de modifier le texte avec l'IA.\nDétails : ${lastError ? lastError.message : "Erreur inconnue"}`);
        showToast("Échec de la modification IA", "error");
    }
}

/* ==========================================================================
   EXTRACTION DE TEXTE DE FICHIERS DE TRANSCRIPTION (WORD/TXT)
   ========================================================================== */

function handleTranscriptionFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const fileType = file.name.split('.').pop().toLowerCase();

    if (fileType === 'txt') {
        readTxtFile(file);
    } else if (fileType === 'docx') {
        readDocxFile(file);
    } else {
        showToast("Format de fichier non supporté (uniquement .docx et .txt)", "error");
    }

    // Réinitialiser la valeur de l'input pour pouvoir importer à nouveau
    e.target.value = '';
}

function readTxtFile(file) {
    const reader = new FileReader();
    reader.onload = function(evt) {
        const text = evt.target.result;
        document.getElementById('transcription-textarea').value = text;
        
        // Mettre à jour le projet actif et déclencher la preview
        const proj = getActiveProject();
        if (proj) {
            proj.transcription = text;
            saveProjectsToLocalStorage();
            updateLivePreview();
        }
        
        showToast("Transcription .txt importée !", "success");
    };
    reader.readAsText(file);
}

function readDocxFile(file) {
    if (typeof mammoth === 'undefined') {
        showToast("La bibliothèque Word n'est pas encore chargée (vérifiez votre connexion internet)", "warning");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
        const arrayBuffer = evt.target.result;
        
        mammoth.extractRawText({ arrayBuffer: arrayBuffer })
            .then(function(result) {
                const text = result.value;
                document.getElementById('transcription-textarea').value = text;
                
                const proj = getActiveProject();
                if (proj) {
                    proj.transcription = text;
                    saveProjectsToLocalStorage();
                    updateLivePreview();
                }
                
                showToast("Fichier Word (.docx) importé !", "success");
            })
            .catch(function(err) {
                console.error("Erreur d'extraction Mammoth", err);
                showToast("Erreur lors de la lecture du fichier Word.", "error");
            });
    };
    reader.readAsArrayBuffer(file);
}

/* ==========================================================================
   RÉDACTION AUTOMATIQUE PAR IA (API GEMINI)
   ========================================================================== */

async function handleAIGenerate() {
    const proj = getActiveProject();
    if (!proj) return;

    const transcription = (proj.transcription || '').trim();
    if (!transcription) {
        showToast("Veuillez d'abord coller ou importer une transcription de note vocale.", "warning");
        return;
    }

    // S'il n'y a pas de clé API, on propose la simulation de répartition locale
    if (!appState.geminiApiKey) {
        if (confirm("Aucune clé API Gemini n'est configurée dans la barre latérale gauche. Souhaitez-vous exécuter l'algorithme local de répartition (sans IA en ligne) ?")) {
            showToast("Répartition locale en cours...", "info");
            autoDispatchFallback(proj);
            showToast("Rapport structuré localement (sans IA) !", "success");
            switchTab('edit');
        }
        return;
    }

    // Avertissement si du contenu existant va être remplacé
    const hasExistingContent = proj.blocks.some(b => b.content && b.content.trim());
    if (hasExistingContent) {
        const confirmed = confirm(
            "L'IA va générer une nouvelle structure de blocs complète.\n" +
            "Le contenu actuel de tous les blocs sera remplacé par les nouvelles sections créées par l'IA.\n\n" +
            "Voulez-vous continuer ?"
        );
        if (!confirmed) return;
    }

    // Afficher l'écran de chargement
    const loader = document.getElementById('ai-loading-overlay');
    if (loader) loader.classList.add('active');

    const formattedDate = proj.visitDate ? proj.visitDate.split('-').reverse().join('/') : 'Non renseignée';
    const guidelines = document.getElementById('ai-guidelines') ? document.getElementById('ai-guidelines').value.trim() : '';

    const promptText = `Tu es un conseiller expert en bâtiment, spécialiste bienveillant et constructif de la restauration et de la préservation du patrimoine bâti ancien traditionnel dans le Perche.
Voici les informations sur une visite conseil effectuée :
- Client : ${proj.clientName || 'Non spécifié'}
- Date de visite : ${formattedDate}
- Adresse du bien : ${proj.visitAddress || 'Non renseignée'}

Voici les consignes spécifiques de l'utilisateur (orientations ou priorités de rédaction) que tu dois impérativement respecter :
"${guidelines || 'Aucune consigne spécifique.'}"

Voici la transcription brute et informelle de la note vocale enregistrée sur le site par le conseiller :
"${transcription}"

Règles de rédaction impératives (Style & Fond) :
0. RESPECT STRICT DE LA TRANSCRIPTION (MOT POUR MOT) : Si l'utilisateur demande dans ses consignes (guidelines) de ne pas reformuler, de reprendre "mot pour mot", de "recopier", ou si la transcription fournie est déjà structurée sous forme de compte-rendu rédigé, tu dois conserver la formulation, les phrases et le vocabulaire d'origine au maximum. Ne reformule pas le contenu ; contente-toi de le distribuer dans les blocs correspondants et de corriger uniquement les coquilles ou fautes d'orthographe évidentes.
1. TON ET STYLE (PAR DÉFAUT) : À moins que la règle 0 ne s'applique, rédige un compte rendu de visite conseil professionnel, bienveillant, constructif et optimiste quant au potentiel du bâtiment. Sois optimiste quant au potentiel de la bâtisse et rassurant pour les acquéreurs/propriétaires. Évite le ton trop froid, austère, alarmiste ou de "diagnostiqueur" (style d'expertise réglementaire froide). Valorise le charme du bâti ancien percheron tout en prodiguant des recommandations claires, pragmatiques et de restauration de patrimoine avec des termes professionnels.
2. PARAGRAPHES AÉRÉS ET FLUIDES : Rédige des phrases bien construites, professionnelles et complètes. Pour que les textes restent parfaitement lisibles et aérés (pour éviter l'effet "gros pavé de texte compact"), divise tes explications en plusieurs petits paragraphes à l'aide de sauts de ligne réguliers.
3. FORMATAGE DES LISTES (TIRETS UNIQUEMENT) : Si tu as besoin d'énumérer des points ou des recommandations, utilise exclusivement des tirets simples ("- ") suivis d'un seul espace en début de ligne (ex: "- Texte"). Interdiction absolue d'utiliser tout autre caractère de liste (comme des astérisques "*", des puces de type emoji, des ronds "•" ou des chiffres), et ne mets jamais plusieurs espaces ou tabulations après le tiret.
4. PROSCRIRE LE FORMATAGE MARKDOWN : Ne mets aucun mot en gras ou en italique avec des doubles astérisques ** ou simples astérisques *. Rédige en texte brut simple. Toute présence d'étoiles est interdite car le texte brut est affiché tel quel.
5. PROFONDEUR TECHNIQUE ET EXPLICATIONS PHYSIQUES :
   - Humidité : Détailler les phénomènes physiques de capillarité et d'enfermement de l'humidité par des dalles béton ou enduits ciment étanches, la nécessité de la perspirance des murs en moellons de pays, et préconiser leur dépose. Conseiller de conserver la chaudière fioul en service et de maintenir le bâtiment chauffé à 15°C en hiver pour lutter contre la condensation.
   - Sols et Dalles : Expliquer l'utilité d'un hérisson ventilé sous une dalle en béton de chaux respirante avec des revêtements compatibles comme la tomette ancienne ou le travertin sur lit de sable.
   - Chauffage et Isolation : Conseiller d'isoler en chaux-chanvre par l'intérieur pour préserver la respiration et l'inertie des murs (notamment sur la façade nord la plus froide), et d'utiliser la laine de bois sur les rampants de toiture pour ses propriétés de déphasage thermique et de confort d'été, ou une solution mixte économique combinant laine de bois entre chevrons et laine de verre dessous. Recommander TP Chauffage – Ludovic Tricoté (TP Chauffage – Saint-Cyr-la-Rosière – 06 79 67 44 07) et Guillaume Franchet (Berd'Huis – 06 88 53 96 47).
   - Charpentes : Détailler l'état et les préconisations selon les bâtiments cités dans la note vocale. Si le garage est mentionné, parler de la déformation/vrillage de la ferme principale sans danger de rupture imminente mais nécessitant une surveillance. Si la cidrerie est mentionnée, conseiller la dépose des solives du plancher en bauge déposé, la pose de jambes de force sur les demi-fermes et la conservation de l'entrait. Si la dépendance d'entrée a son entrait exposé, préconiser une protection provisoire ou un bardage bois rapide.
   - Gestion des eaux : Préciser que l'absence de gouttières est classique sur les façades percheronnes pour mettre en valeur les corniches en briques, et que si des gouttières sont installées, il faut privilégier des gouttières nantaises intégrées en couverture. Préconiser un décaissement du terrain sur 3 à 4 mètres à l'arrière pour éloigner les eaux de ruissellement et un drainage périphérique si besoin.
   - Assainissement : Si mentionné, estimer le besoin à 10 Équivalents-Habitants (EH) pour l'habitation et les gîtes, et recommander de faire appel à Karl Delozier d'Alençon pour l'étude de sol et de conception.
5. CARNET D'ADRESSES ET LIENS : Intégrer les professionnels recommandés cités ci-dessus (et Sébastien Blanchet pour l'éco-construction et l'isolation bio-sourcée). Proposer également Géoportail (https://www.geoportail.gouv.fr) et Géorisques (https://www.georisques.gouv.fr) comme ressources documentaires.
6. STRUCTURE ET TITRES DES BLOCS : Structure le rapport en générant les blocs appropriés parmi les thèmes suivants. Tu dois utiliser **exactement** la liste de titres ci-dessous pour les blocs créés (en majuscules) :
   - 'intro' : OBJET DE LA VISITE
   - 'presentation' : PRESENTATION GENERALE
   - 'etat-general' : ÉTAT GÉNÉRAL DU BÂTI
   - 'patrimoine' : OBSERVATION PATRIMONIALE
   - 'espaces' : ORGANISATION FUTURE DES ESPACES
   - 'humidite' : HUMIDITÉ
   - 'recommandations-humidite' : RECOMMANDATIONS RELATIVES À L'HUMIDITÉ
   - 'sols' : SOLS ET DALLES
   - 'isolation' : CHAUFFAGE ET ISOLATION
   - 'maconnerie' : MAÇONNERIES ET ENDUITS
   - 'charpente' : CHARPENTES
   - 'couverture' : COUVERTURES
   - 'ventilation' : VENTILATION
   - 'cheminees' : CHEMINÉES
   - 'eaux-pluviales' : GESTION DES EAUX PLUVIALES ET AMÉNAGEMENTS EXTÉRIEURS
   - 'assainissement' : ASSAINISSEMENT
   - 'conclusion' : CONCLUSION
   - 'professionnels' : PROFESSIONNELS RECOMMANDES
   - 'ressources' : RESSOURCES DOCUMENTAIRES

Tu dois impérativement renvoyer le résultat sous la forme d'un TABLEAU JSON (array), sans aucun autre texte ni balise markdown. Chaque élément du tableau est un bloc avec les champs "id", "title", et "content" (paragraphes rédigés avec sauts de ligne si besoin). Exemple de format attendu :
[
  { "id": "intro", "title": "OBJET DE LA VISITE", "content": "Dans le cadre d'un projet de rénovation...\n\nLa visite conseil s'inscrit dans..." },
  { "id": "presentation", "title": "PRESENTATION GENERALE", "content": "La ferme en L du milieu du dix-neuvième siècle...\n\nLe bâtiment principal..." }
]`;

    try {
        let data = null;
        let success = false;
        let lastError = null;
        const modelsToTry = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash'];

        for (const modelName of modelsToTry) {
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${appState.geminiApiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: promptText }] }]
                    })
                });

                if (response.ok) {
                    data = await response.json();
                    success = true;
                    break;
                } else {
                    let errorMsg = `${modelName} - Code erreur HTTP : ${response.status}`;
                    try {
                        const errData = await response.json();
                        if (errData && errData.error && errData.error.message) errorMsg += ` - ${errData.error.message}`;
                    } catch (e) {}
                    lastError = new Error(errorMsg);
                    console.warn(`Échec avec ${modelName} :`, errorMsg);
                }
            } catch (err) {
                lastError = err;
                console.warn(`Erreur réseau avec ${modelName} :`, err.message);
            }
        }

        if (!success) throw lastError || new Error("Aucun modèle Gemini disponible n'a pu être contacté.");

        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
            throw new Error("Réponse de l'IA incomplète ou vide.");
        }

        let jsonText = data.candidates[0].content.parts[0].text.trim();
        if (jsonText.startsWith("```")) {
            jsonText = jsonText.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
        }
        jsonText = jsonText.trim();

        const aiBlocks = JSON.parse(jsonText);

        // Valider que la réponse est bien un tableau
        if (!Array.isArray(aiBlocks) || aiBlocks.length === 0) {
            throw new Error("La réponse de l'IA n'est pas au format tableau attendu.");
        }

        // Remplacer COMPLÈTEMENT les blocs du projet par ceux générés par l'IA
        proj.blocks = aiBlocks
            .filter(item => item.title && item.content && item.content.trim()) // Ignorer les blocs vides
            .map(item => ({
                id: generateBlockId(),
                title: item.title.trim(),
                content: cleanContentFormatting(item.content.trim()),
                status: 'done'
            }));

        if (proj.blocks.length === 0) {
            throw new Error("L'IA n'a généré aucun bloc avec du contenu. Vérifiez votre transcription.");
        }

        // Mettre à jour le bloc actif (pointer sur le premier bloc)
        appState.activeBlockId = proj.blocks[0].id;

        saveProjectsToLocalStorage();
        loadCurrentProjectIntoUI();
        renderBlockList();
        updateLivePreview();
        switchTab('edit');

        showToast(`Rapport structuré par l'IA : ${proj.blocks.length} sections créées !`, 'success');

    } catch (err) {
        console.error("Erreur lors de la génération par IA", err);
        alert(`Une erreur est survenue lors de l'appel à l'IA Gemini.\n\nDétails : ${err.message}\n\nVeuillez vérifier votre connexion internet et la validité de votre clé API.`);
        showToast("Échec de la génération par IA", "error");
    } finally {
        if (loader) loader.classList.remove('active');
    }
}

/* Algorithme local alternatif de répartition si pas de connexion/pas de clé API */
function autoDispatchFallback(proj) {
    const formattedDate = proj.visitDate ? proj.visitDate.split('-').reverse().join('/') : 'Non renseignée';
    const visitTypeLabel = proj.visitType === 'achat' ? 'visite conseil avant achat' : 'visite conseil avant travaux';
    const paragraphs = proj.transcription.split(/\n+/).filter(p => p.trim());

    // Créer une structure dynamique basée sur les thématiques détectées dans la transcription
    const themes = [
        { key: 'toiture', title: 'Toiture et Charpente', keywords: ['toiture', 'charpente', 'ardoise', 'tuile', 'chevron', 'gouttière', 'infiltration', 'xylophage', 'faitage', 'zinc'] },
        { key: 'maconnerie', title: 'Gros Œuvre et Maçonnerie', keywords: ['mur', 'fondation', 'fissure', 'pignon', 'plancher', 'dalle', 'poutre', 'solive', 'structure'] },
        { key: 'facades', title: 'Façades et Enduits', keywords: ['façade', 'enduit', 'ciment', 'chaux', 'pierre', 'joint', 'rejointoiement', 'piquage'] },
        { key: 'humidite', title: 'Humidité et Drainage', keywords: ['humidité', 'salpêtre', 'drain', 'capillaire', 'cave', 'condensation', 'moisissure', 'ruissellement'] },
        { key: 'isolation', title: 'Isolation et Second Œuvre', keywords: ['isolation', 'doublage', 'chanvre', 'laine', 'tomette', 'menuiserie', 'fenêtre'] },
        { key: 'reseaux', title: 'Réseaux et Équipements', keywords: ['électricité', 'plomberie', 'chauffage', 'chaudiere', 'assainissement', 'fosse', 'spanc'] }
    ];

    const blocksContent = {};

    paragraphs.forEach(p => {
        const text = p.toLowerCase();
        let bestTheme = null;
        let bestScore = 0;

        themes.forEach(theme => {
            const score = theme.keywords.filter(kw => text.includes(kw)).length;
            if (score > bestScore) { bestScore = score; bestTheme = theme.key; }
        });

        if (bestTheme && bestScore > 0) {
            blocksContent[bestTheme] = (blocksContent[bestTheme] ? blocksContent[bestTheme] + '\n\n' : '') + p.trim();
        }
    });

    // Construire le tableau de blocs dynamiquement (seulement les thématiques avec du contenu)
    const newBlocks = [
        {
            id: generateBlockId(),
            title: 'Introduction et Contexte',
            content: `Visite conseil réalisée le ${formattedDate} à l'adresse suivante : ${proj.visitAddress || 'Non renseignée'}.\n\nCette visite a été effectuée dans le cadre d'un projet de ${visitTypeLabel} pour le compte de ${proj.clientName || 'Non spécifié'}.`,
            status: 'done'
        }
    ];

    themes.forEach(theme => {
        if (blocksContent[theme.key]) {
            newBlocks.push({
                id: generateBlockId(),
                title: theme.title,
                content: blocksContent[theme.key],
                status: 'progress'
            });
        }
    });

    newBlocks.push({
        id: generateBlockId(),
        title: 'Conclusion',
        content: '',
        status: 'empty'
    });

    proj.blocks = newBlocks;
    appState.activeBlockId = proj.blocks[0].id;

    saveProjectsToLocalStorage();
    loadCurrentProjectIntoUI();
    renderBlockList();
    updateLivePreview();
}

/* Fonction globale pour replier/déplier les sections de la barre latérale */
window.toggleSidebarSection = function(containerId, arrowId) {
    const el = document.getElementById(containerId);
    const arrow = document.getElementById(arrowId);
    if (el) {
        const isHidden = el.style.display === 'none';
        if (isHidden) {
            el.style.display = ''; // Rétablit l'affichage par défaut (flex ou block)
            if (arrow) arrow.style.transform = 'rotate(0deg)';
        } else {
            el.style.display = 'none';
            if (arrow) arrow.style.transform = 'rotate(-90deg)';
        }
    }
};

function handleEmailClient() {
    const proj = getActiveProject();
    if (!proj) return;

    // Récupérer et formater la date
    let formattedDate = 'Non renseignée';
    if (proj.visitDate) {
        const parts = proj.visitDate.split('-');
        if (parts.length === 3) {
            formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
    }

    const email = (proj.clientEmail || '').trim();
    const clientName = proj.clientName || 'Madame, Monsieur';
    
    // Sujet de l'e-mail personnalisé avec la date et le nom du client
    const subjectText = `Compte-rendu de visite conseil du ${formattedDate} - ${proj.clientName || 'Client'}`;
    
    const bodyText = `Bonjour ${clientName},\n\n` +
        `Veuillez trouver ci-joint le compte-rendu de la visite conseil effectuée le ${formattedDate}.\n\n` +
        `Nous restons à votre entière disposition pour tout renseignement complémentaire.\n\n` +
        `Bien cordialement,\n\n` +
        `Fabrice Mauger\n` +
        `EURL BÂTI PERCHERON\n` +
        `06 95 30 15 25\n` +
        `www.batipercheron.fr`;

    // Remplir les inputs de la modale
    document.getElementById('email-modal-to').value = email;
    document.getElementById('email-modal-subject').value = subjectText;
    document.getElementById('email-modal-body').value = bodyText;

    // Afficher la modale
    const modal = document.getElementById('email-modal');
    if (modal) {
        modal.classList.add('active');
    }
}

async function handleDirectEmailSend() {
    const to = document.getElementById('email-modal-to').value.trim();
    const subject = document.getElementById('email-modal-subject').value.trim();
    const body = document.getElementById('email-modal-body').value.trim();

    if (!to) {
        alert("Veuillez renseigner l'adresse email du destinataire.");
        return;
    }

    if (SMTP_SECURE_TOKEN === 'VOTRE_TOKEN_SMTPJS' || !SMTP_SECURE_TOKEN) {
        alert("L'envoi direct d'e-mail n'est pas encore activé. Veuillez configurer votre Secure Token SMTPJS dans le fichier app.js.");
        return;
    }

    const proj = getActiveProject();
    if (!proj) return;

    // Nom de fichier du PDF propre basé sur le nom du client et la date
    const clientClean = (proj.clientName || 'SansNom').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const pdfFilename = `CompteRendu_${clientClean}_${proj.visitDate || 'date'}.pdf`;

    // Désactiver le bouton d'envoi et afficher un message de chargement
    const btnSend = document.getElementById('btn-email-modal-send');
    const oldBtnText = btnSend.innerText;
    btnSend.disabled = true;
    btnSend.innerText = "⏳ Génération du PDF...";

    try {
        // 1. Récupérer l'élément de la prévisualisation A4
        const previewElement = document.getElementById('document-preview-target');
        
        // Options de génération html2pdf
        const opt = {
            margin:       0,
            filename:     pdfFilename,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, logging: false },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        // 2. Générer le PDF
        const pdfWorker = html2pdf().from(previewElement).set(opt);
        const pdfBlob = await pdfWorker.output('blob');
        
        // 3. Lire le blob sous forme de base64 data URI
        const reader = new FileReader();
        reader.readAsDataURL(pdfBlob);
        reader.onloadend = function() {
            const base64data = reader.result;
            
            btnSend.innerText = "✉️ Envoi de l'e-mail...";

            // 4. Envoyer l'email via SMTPJS
            Email.send({
                SecureToken : SMTP_SECURE_TOKEN,
                To : to,
                From : SENDER_EMAIL,
                Bcc : BCC_EMAIL,
                Subject : subject,
                Body : body.replace(/\n/g, "<br>"), // SMTPJS utilise le format HTML
                Attachments : [
                    {
                        name : pdfFilename,
                        data : base64data
                    }
                ]
            }).then(
                message => {
                    btnSend.disabled = false;
                    btnSend.innerText = oldBtnText;
                    
                    if (message === "OK") {
                        closeModal();
                        showToast("E-mail envoyé avec succès !", "success");
                    } else {
                        console.error("Erreur SMTPJS:", message);
                        alert("Erreur lors de l'envoi de l'e-mail : " + message);
                        showToast("Échec de l'envoi de l'e-mail", "error");
                    }
                }
            ).catch(err => {
                btnSend.disabled = false;
                btnSend.innerText = oldBtnText;
                console.error("Erreur d'envoi de mail :", err);
                alert("Une erreur est survenue lors de l'envoi de l'e-mail.");
                showToast("Échec de l'envoi de l'e-mail", "error");
            });
        };

    } catch (error) {
        btnSend.disabled = false;
        btnSend.innerText = oldBtnText;
        console.error("Erreur lors de la génération du PDF ou de l'envoi :", error);
        alert("Erreur technique lors de la génération du PDF ou de l'envoi.");
        showToast("Échec de l'envoi de l'e-mail", "error");
    }
}


function cleanContentFormatting(text) {
    if (!text) return '';
    
    // 1. Remplacer les espaces multiples après un tiret en début de ligne par un seul espace
    let clean = text.replace(/(^|\n)\s*-\s+/g, '$1- ');
    
    // 2. Supprimer les doubles astérisques de gras markdown
    clean = clean.replace(/\*\*/g, '');
    
    // 3. Supprimer les simples astérisques de liste ou d'italique
    clean = clean.replace(/(^|\n)\s*\*\s+/g, '$1- ');
    clean = clean.replace(/\*/g, '');
    
    return clean;
}

function formatAddressHTML(address) {
    if (!address) return '<i>Non renseignée</i>';
    
    let formatted = escapeHTML(address);
    
    // Détecter un code postal à 5 chiffres (ex: 61260 Ceton) et forcer le saut de ligne juste avant
    const regex = /(?:\s*,\s*|\s*-\s*|\s+)(\d{5}(?:\s+[a-zA-ZÀ-ÿ\s-]+)?)$/;
    const match = formatted.match(regex);
    if (match) {
        const index = formatted.lastIndexOf(match[0]);
        formatted = formatted.substring(0, index) + '<br>' + match[1];
    }
    
    return formatted;
}

function linkify(text) {
    if (!text) return '';
    
    // Expression régulière pour capturer les URL (http, https, www)
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
    
    return text.replace(urlRegex, function(url) {
        let href = url;
        if (!href.match(/^https?:\/\//i)) {
            href = 'https://' + href;
        }
        // Nettoyer la ponctuation à la fin de l'URL capturée
        let cleanUrl = url;
        let endChar = '';
        if (/[.,;)]$/.test(cleanUrl)) {
            endChar = cleanUrl.slice(-1);
            cleanUrl = cleanUrl.slice(0, -1);
            href = href.slice(0, -1);
        }
        return `<a href="${href}" target="_blank" style="color: var(--color-primary); text-decoration: underline; font-weight: 500;">${cleanUrl}</a>` + endChar;
    });
}
