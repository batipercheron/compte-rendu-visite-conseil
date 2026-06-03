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
    const metaIds = ['meta-client-name', 'meta-visit-address', 'meta-visit-date', 'meta-consultant'];
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

    // Bouton de téléchargement du PDF
    const btnDownloadPdf = document.getElementById('btn-download-pdf');
    if (btnDownloadPdf) {
        btnDownloadPdf.addEventListener('click', handleDownloadPdf);
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
            <img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAFnBQADASIAAhEBAxEB/8QAGgABAAMBAQEAAAAAAAAAAAAAAAMEBQIBBv/EABcBAQEBAQAAAAAAAAAAAAAAAAABAgP/2gAMAwEAAhADEAAAAt8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACncqwWhVWhV5ucHMMd4rcXYiVHJQAAAAhJlX2LKqLSqLQoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZsaVXjwkR+LKjEnMkaWa3QcdltKpLSrITIYy0qykrzmu6tqrFoUAq9IsK/BbUL4FAAPPRW5myuer9rG17OxuRd+ZeLrqN7UCgAFeXJxdlBPqBSvJl4uge149rxOzfc3Retzx7Xi1Lm6VRRWs8lULGLcmOmQoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQv5sWHPZ5552s8PfCc++crcFgACraqR7aqWTqrPAcy8WirJHaKrqUg8t0Tta9OOyq8/HMTCgAAIsrVyuemvka52OmVG9TzaN6jPz1pjtgAClSmi47n0sbW3nsbkMdn3INFS3Uyoe+e8umyO/MDP0PPYZ+hny1bFexz1pDtgAAq8xcU7J2rWQqzEijcOlWUlcd0ccxKjhLSKItIBOjiLJAToZqFaLKhfCrYOhQAAAAAAAAAAAAAAAADL1MqJ5I51594tpX899OLFfk6APD1JGLNYWYORJNV9PLVbwdRynUdkQ8dck/VO4BStZqxaFAAARZWrlc9NfI1zsdMs2znc9LcWkdDpkBWs5mbYhvxxl3KfWNbDz3tgABUt1MqHvnvLpsjvzAAZ+hn5tWxXsc9aQ7YAAq8d2YqQzeK5kkIJ4/D3znstUJYCe3V8RxLyq1BwkU1e2s9TrlObdPscTcrzcqW0q2IojjqG2vEUvZYFgAAAAAAAAAAAAAAAADN0s2LHfIew2Dl5YKwLQoCqeRbV+iZXFir1EXefah1aAKRyCl3PSl0FewiraqloUAABFlauVz0t1NeKkWm3Mazao4un7jXNS6NwCKn7ZxZxuZMd2lx3oWsvU6ZDUAVLdTKh757y6bI78wAGfoZ+bVsV7HPWkO2AADn09c9AABz0Dk6AAAAAAAOTpz0Hg9AAAAAc9AAAAAAAAAAAAqRbVfSzByDwevB68E/HA8ODt1yT91eSzT7tlXy4Kc01IXalsCgAEcgoWEMXavMhYFAAARZWrlc9NfI1zsdMvPRkx3KfHd27ka+8ueqepVsrudUl1ZRqbObm19XKtS6A64AVLdTKh757y6bI78wAGfoZ+bVsV7HPWkO2AAKkkduKnvNwj5i8PZ+6ZxLzdPII/SK7X8PerNE6ljtihfqEscvJ1D5cIvK/R75cpE1aUsknFdJO5axPDxdI+I+Tq3xSJu4OFmt1LaBQAAAAAAAAACraqxaFAAAAAKtqrC1DGWvK3JDpRwFtVFqr5Oe1rg47rCyKAHh5W8uQFAAAARZWrlc9NfI1zsdMgUackfHfevSu7yyb1Vb/AGayFK9hGL71xx6bHVO525hSpbqZUPfPeXTZHfmAAz9DPzativY560h2wABWskVrIVo7op+2xnyXBBxaFKSyKcWiIebAVLYr9yiotil7cFP22K3NsVvbApLoq2grLI8rWhS6tiraAKAAAAAAAAAAVbVWLQoAAAABVtVYtV7FUe2YCSsuFXy2K/NbTKq0Kq1GV54PS2qWj2l3YOhQAAAA8I8rQj56p69S7Z6Nxn2GbnXLnsCvqVLcMuNWXnvTIA4ipTv8Y1W16MlWnnu8qlivm0PbbGrytZ6YCgGfbgzaNiT3FuoZumQoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABVtRRKqi0q8lxRF5RF5RF5VFqqFqtYgLHPXlZ+jV8i3zX8INKraAoBBOKa3XiSUoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABTuVYkTCFMIUwq8J1j8tkh559LPnvlV++eYLVUWqtoCgAKtqragKVbSMPnmHOrkkujZkc7NWor3zckfQ88yWZ1LVwpqxPQ+lTKaysmHcrFfRytVFO4MLyDzOr3Vu3qY/mzVIb3zncfRIZtQAZcX6Gdcl571e6ymqTLuSZa7DF2kgztjHWGajel0Zy5CuKGlUjMV2dbVw1nyjfjMVXZ1e60JtTJawxJtDLjZGpRz9v5zNsTUd5aPOwsxrfuNH0vvz+5ZIKHB3VzYc29NZlsqQ6Izb1HMl+lZ+hYrWRix+1s61dH5rcssjUeeihBo58t+YsAAAAAAAAVbVWLQoACnJz1FjiD064tVS1xByS8Wqpaq2qotVbQFAOeq0e2PPQKA+fhmhxrV0c7R1kKx6OrlZ1c2vm/pLK2Fu4Ur6X5r6VPRqAV7BAV81575je3bqW9YCsalp5mdWtz5z6OwVkpZ5nVzail1kKAAoXyGPsY60b1G9m7A3kBUt1IxBnf0w3hHJHHzozv6CaGbWApXsICuPnPo/nM1vYO8WBqMPcyZc+7SmzfoBvPmDczM1uZW+BqAMTbqxh6+R1nX0jnrecSGfSzrBk48l+j7xdrWAqLP0M+XVFgAAAAAAACraqxaFAAVOfepS0SqtCr5b5OYfeS3Ws1D21UtgUAq2qsWhQAHz8M0ONaujnaOshWZmWK+NTfQUb2pWwt3ClfS/NfQJMiWSouzoUB81575je3bqW9YHFZdDtjU+5DNrLG2fnlingvZuwN5AAAAY+xjy0b1G5m7ThrPbgd1LFUxhnf0w3hHJHHzozv6CarLrEqISuO6A4+c+j+czW9g7xYGoxdX5/N8u191ZCPWcGMxvS1KN7WAoB56PmvJocb17+Psaxi7WLtLm5f02JFTWyfZfpUE+sxZ+hnrqiwAAAAAAABBOKq1Ug6HjzlZ+ffUh8mFfy36V+/eSzDFMV5ex5BZFZZFdP4QydwlwUAB8/DNDjWro52jrKjejMPTulCythbuFnS3U+lMVtrMTVmIFAfNee+Y3t26kmsd41fya09ChpXIU+b+k+dzY9DPvy643kAAABj7GPLRngvZsrTazmNMZkWxUXEGdfTDeEckcfOjO7XurNrOI2xWsiBXHzn0fzma3sHeLEMeHVi7la8t3o1lBPDHz4zvauUrusBQAGFWsV8at7eLtamLtYu0OO1nzse7h51Lv/NXjTz9DPs1RYAAAAAAAAAq2qcXEPhw88W4i7Tp4r14Pas0Ee2qtoCgAAFW1Vi0KAA+fhmhxrV0c7R1kKAArYW7hZ0+l+a+lT0agAAHzXnvmN7dupb1jLzfpsOWruYfcv0aOTeWLtVIxLFf3O/pUcm8AAAAMfYx5aN6jezdgbyAqW6kYgzv6Ybwjkjj50Z39BNDNrAUABx859H85mt7B3ixka/lnzXs0Gd71j57f1noWfN83qONamlibeoFgAhMLgxvT04ZtYxdrF2lCxmaaPmVqrnepxn6FmqNZAAAAAAAAAAj97QFRcWEVubdUrNMZ1/qqLVW0BQAACraqxaFAAfPwzQ41q6Odo6yFAAVsLdws6fS/NfSp6NQeEcuLtQFfNee+Y3t26lvWHHavnY93Dzqfe+Z0E1hqYtP6XHzetf5nSNR57qAHmbE9zD3Bj7GOtG9RvZuwN5AVLdSMQZ39MN4RyRx86M7+gmhm1gKRyYkbXpXHzn0fzma3sHeLA1IsD6SpLiW6jOvpmbpaxFgfSVVxPofn7Mu2NZAZV7BzfL0e2ejUxdrF2pQsA4+f+jqS4mjnaMuqNZAAAAAAAAAAAAARSip7aRV6sCrajhLSqLSqLSqLSqLVVKSigFW0j57j6RLj6cqwKAc9DMzvpEvzd3XGS1hkwboxtkRTuD5t9Ily9HtYFKtpGBF9IlydGVYFVqGwjCm1y5TVJkWro89Kgy9tHzs+2WCcQK4z9NHzr6JLSulnlDQHzb6RLjd6yslrDE53QFlDK+kS/N6WkOeiwClmfQJfm7+qOOyyPN1kY163yQ17vRiXrwClayjB07YCgAMr3UQFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/9oADAMBAAIAAwAAACHzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzy/8A/rnrU88884j/AP8AzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzvHTD3/x/b7rz/wA8z++888sGf8a9888r+8PMPLMPesb+8888888888888888888888888888888888888/1Q/I888j3zf/XJHcP8888V+8s6884e18H8/wDvLNfK/PPP8svssvOvsruutOmuvPPPPPPPPPPPPPPPPPPeL84wXbU8285br1vD/PPPFfvPrfPKO/8Azzz/AO8888r888bkk0w8bEDgPpYfPIA888888888888888888pFd3x88t6y/qe88Q+/8888V/wCF3/PEfH9PPP8A7zzzyvzzzjxxzxyzyzzyzzyzxzzzzzzzzzzzzzzzzzrvM100NlXt9+//AM88sVj8888V+88/35MMqq88/wDvPPPK/PPPwY64S7Wz68x0dcEy45b4F/PPPPPPPPPPP/PPPPPP8748/wB7vzzzfzzzzxX7zjd8j7yrbXz/AO8888r888eefvf+v/O+ePPvPev+POP+88888888888/888888/vL3Ll/P8Act/PPPPOFseCJ+qtPOvbPMLPvPML/vPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOs89/wD/AD3XsJ33888zc8888888888888888888888888888888888888888888888888888888888888888vuOugvr4nv/APPPJ/Lt7jB5nMzHNblzKN/PM13DTP3KXvP/ANav+QzOxvwy/Xzid0//AO+fS88Mc88888888r888Bj/AL9//wDzy77zxf8A8Vc8D88+8U/89U6fX888+8r88/8AFKvFvPvK/wDyj/w+fzyn/Tzbfzzzzzzzzzzz/wA88E//AP172/PO/PPF/wDx9TwP7rzxT/xdfj/zzzzzy/77/wAUq8X+88r/APL8PPn/ADzz53zu/wC8888888888879kLR51b1zJFR888X/AO3PPIPP/PFOxNfP+/PPPPPK/fbPFKvFPHvK/wDQzy7z/wA88Xc88RM888888888887+02847/8APPPP/PPF/wDzzzwPzzzxT9O/Tnrzzzzzyvzz/wAUq8W888r/AK/sLF/PPPPt/PP/AJTzzzzzzzzzzz7y792vfzzzz/zzxf8A8888D84/8U/sdv8AP2/PN9fK/PP/ABSrxbz/AEr/APGPtyBNPNu/PPPHPfPPPPPPPPPPPPPLP3t//wD/AP8A/PLj/wDzyyxwxz+49/y75/w8w23x8x7y8/74+wwyywzzzzxw+me1z43zzx3zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/2gAMAwEAAgADAAAAEPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOPnrASHPPPPORvvvPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOvxhjxQks89+KvOOP/APzzyx6zxPDzzyp3xqEA8FTQn73zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzylcYRbzzzxDgzxm9Txbzzzzz3z6/zzhvHzPymrzxX3zzzzzP/AP8A/wDTPPefPfXtfPzzzzzzzzzzzzzzzzzy/rwmX+dP0wDzs8F/yrzzzzz3z7Tzytrzzzymrzzz3zzzy0mKY4L3Y0T1u7y0U7zzzzzzzzzzzzzzzzzysffwvzzPvOy//wA8W/688888/t7Y08tg8188pq88898888w088088888888480888880888888888887KAfv/gvrwtcds888s3588888988cWsM+to88pq88898888EHF839D10M4YvTeVFET0u088888888888q888888+UoZ+sP0884M888888984c2gf89mU8pq88898888ffc8cfs8fvfs8se/s/Of8AP/PPPPPPPPPPPvPPPPPPquEPF3rP89HPPPPOMf8AzFRkLTzthDyrD3zznHXzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzyv7zDzD6gKj+xzzy2lzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzyg89+oonzln7zzwTz/q9l3frk5le9MX333z4Vx+3S3D/y3F/7GQ7rx2J6VvzxZcz7/wD6X8sN988888888+88878I00qe887/APPKffKPaqPPP/AlvKPf5bfPPF/gvPPAvPwl/P8Az0HzxPzlzzy8LRIjTzzzzzzzzzzyrzzza54xWrrDCbzzyn3yp6q3/vzwJbyfX1Pzzzzz4b//AIC8/CU/089B8qK4g1888oXUhT388888888889NnekX3fgjVTTz888p9ie8qb8p88CUZ38uW88888+TPPMC8/CV8X89Bsy8/C0888h8Usgm888888888884zW3w0o+8888+888p9888qo8888CWpi8rQ88888+C888C8/CX8889BsAysB2885EUU86A28888888888sP8/o/Me8888+888p9888qo8818CW8ol8Fx8863+C888C8/CX8189B84Ie4788zN8U88eU88888888888888suvU++++k88/Os888tNOMcvus8vPc8NI3/APLTX/LHv7zjjrfDHHPPjfDHzL/L/wDzzy/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz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" class="doc-logo-img" alt="Bati Percheron">
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

async function handleDownloadPdf() {
    const proj = getActiveProject();
    if (!proj) {
        showToast("Aucun projet actif", "error");
        return;
    }

    const clientClean = (proj.clientName || 'SansNom').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const pdfFilename = `CompteRendu_${clientClean}_${proj.visitDate || 'date'}.pdf`;

    const btnDownload = document.getElementById('btn-download-pdf');
    const oldBtnText = btnDownload ? btnDownload.innerText : '';
    if (btnDownload) {
        btnDownload.disabled = true;
        btnDownload.innerText = "⏳ Génération du PDF en cours...";
    }

    try {
        const previewElement = document.getElementById('document-preview-target');
        
        // Ajouter une classe temporaire pour supprimer les espacements d'écran pendant la génération PDF
        document.body.classList.add('pdf-exporting');

        // Configuration compressée pour le PDF
        const opt = {
            margin:       0,
            filename:     pdfFilename,
            pagebreak:    { mode: 'css' }, // Mode CSS pur pour respecter uniquement nos .document-sheet
            image:        { type: 'jpeg', quality: 0.70 }, // Qualité compressée (70%)
            html2canvas:  { scale: 1.5, useCORS: true, logging: false }, // Échelle réduite (1.5)
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        
        // Générer et télécharger le PDF
        await html2pdf().from(previewElement).set(opt).save();

        // Retirer la classe temporaire
        document.body.classList.remove('pdf-exporting');

        if (btnDownload) {
            btnDownload.disabled = false;
            btnDownload.innerText = oldBtnText;
        }
        
        showToast("✅ Le PDF a été téléchargé avec succès !", "success");

    } catch (error) {
        document.body.classList.remove('pdf-exporting');
        if (btnDownload) {
            btnDownload.disabled = false;
            btnDownload.innerText = oldBtnText;
        }
        console.error("Erreur lors de la génération du PDF:", error);
        alert("Erreur lors de la création du PDF :\n" + (error.message || error));
        showToast("Échec du téléchargement", "error");
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

