/* ==========================================================================
   DONNÃ‰ES STATIQUES & BIBLIOTHÃˆQUE DE PRÃ‰CONISATIONS
   ========================================================================== */

// Configuration en arriÃ¨re-plan (IA Gemini et Envoi de mails)
const GEMINI_API_KEY = 'AQ.Ab8RN6Ku4gDM_MSl6TjLV-t2BJ7Q8ouyptt_dXz4ssRolhstZg';
const SMTP_SECURE_TOKEN = 'VOTRE_TOKEN_SMTPJS'; // REMPLACEZ PAR VOTRE SECURE TOKEN SMTPJS OBTENU SUR SMTPJS.COM
const SENDER_EMAIL = 'fabrice.mauger@orange.fr';
const BCC_EMAIL = 'fabrice.mauger@orange.fr';
const INSTAGRAM_URL = 'https://www.instagram.com/batipercheron';

// Structure de dÃ©part minimaliste - l'IA gÃ©nÃ¨re la structure complÃ¨te lors de la rÃ©daction
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

// Utilitaire pour gÃ©nÃ©rer un identifiant unique de bloc
function generateBlockId() {
    return 'bloc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

/* ==========================================================================
   GESTION DE L'Ã‰TAT DE L'APPLICATION (STATE)
   ========================================================================== */

let appState = {
    projects: {},            // Tous les projets stockÃ©s localement { id: project }
    currentProjectId: null,  // ID du projet en cours d'Ã©dition
    activeTab: 'edit',       // Onglet actif : 'edit' ou 'vocal'
    activeBlockId: 'intro',  // Bloc actif dans l'Ã©diteur
    geminiApiKey: '',        // ClÃ© API Google Gemini
    customAIInstructions: '', // Instructions personnalisÃ©es globales
    lastVocalInstruction: '' // DerniÃ¨re consigne vocale pour sauvegarde Ã©ventuelle
};

// ModÃ¨le d'un projet par dÃ©faut
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
    
    // Si aucun projet n'existe, on en crÃ©e un par dÃ©faut
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
    
    // Charger la clÃ© API Gemini en arriÃ¨re-plan
    appState.geminiApiKey = GEMINI_API_KEY;

    // Charger les instructions personnalisÃ©es IA
    const storedInstructions = localStorage.getItem('batipercheron_custom_ai_instructions');
    if (storedInstructions) {
        appState.customAIInstructions = storedInstructions;
    }

    loadCurrentProjectIntoUI();
    showToast('Application prÃªte (historique des comptes rendus chargÃ©)', 'info');
}

function loadProjectsFromLocalStorage() {
    try {
        const stored = localStorage.getItem('batipercheron_projects');
        if (stored) {
            appState.projects = JSON.parse(stored);
            
            // Migration : Mettre Ã  jour l'ancien conseiller, nettoyer les esperluettes (&) et fusionner observations/prÃ©conisations
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
                        // Fusionner observations et prÃ©conisations si nÃ©cessaire
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
        console.error('Erreur lors de l\'Ã©criture dans le LocalStorage', e);
    }
}

function getActiveProject() {
    return appState.projects[appState.currentProjectId];
}

/* ==========================================================================
   Ã‰COUTEURS D'Ã‰VÃ‰NEMENTS (EVENT LISTENERS)
   ========================================================================== */

function setupEventListeners() {
    // Actions globales en en-tÃªte
    document.getElementById('btn-new-project').addEventListener('click', handleNewProject);
    document.getElementById('btn-export-json').addEventListener('click', handleExportJSON);
    document.getElementById('btn-import-trigger').addEventListener('click', () => {
        document.getElementById('file-import-input').click();
    });
    document.getElementById('file-import-input').addEventListener('change', handleImportJSON);
    document.getElementById('btn-print').addEventListener('click', () => window.print());
    document.getElementById('btn-open-projects-list').addEventListener('click', showProjectsModal);

    // MÃ©tadonnÃ©es (Changements en direct)
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



    // Ã‰diteur de bloc : champs de texte
    const contentTextarea = document.getElementById('editor-content');
    const blockStatusSelect = document.getElementById('editor-block-status');

    if (contentTextarea) {
        contentTextarea.addEventListener('input', (e) => {
            updateActiveBlockData('content', e.target.value);
        });
    }

    blockStatusSelect.addEventListener('change', (e) => {
        updateActiveBlockData('status', e.target.value);
        renderBlockList(); // Mettre Ã  jour les couleurs des badges dans la barre de gauche
    });

    // Boutons de validation de la suggestion IA
    const btnAcceptIa = document.getElementById('btn-accept-ia-suggestion');
    const btnRejectIa = document.getElementById('btn-reject-ia-suggestion');
    const btnSaveAsRule = document.getElementById('btn-save-as-rule');
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
                showToast("Modification IA appliquÃ©e !", "success");
            }
        });
    }

    if (btnRejectIa) {
        btnRejectIa.addEventListener('click', () => {
            if (suggestionContainer && suggestionTextarea) {
                suggestionContainer.style.display = 'none';
                suggestionTextarea.value = '';
                showToast("Proposition IA ignorÃ©e", "info");
            }
        });
    }

    if (btnSaveAsRule) {
        btnSaveAsRule.addEventListener('click', () => {
            if (appState.lastVocalInstruction) {
                const currentInstr = appState.customAIInstructions || '';
                const newInstr = currentInstr ? currentInstr + "\n- " + appState.lastVocalInstruction : "- " + appState.lastVocalInstruction;
                
                appState.customAIInstructions = newInstr;
                localStorage.setItem('batipercheron_custom_ai_instructions', newInstr);
                
                showToast("RÃ¨gle globale enregistrÃ©e !", "success");
            } else {
                showToast("Aucune instruction rÃ©cente Ã  sauvegarder.", "warning");
            }
        });
    }

    // Ajouter un bloc personnalisÃ©
    document.getElementById('btn-add-block').addEventListener('click', handleAddBlock);

    // FenÃªtre Modale (Fermeture)
    document.querySelectorAll('.modal-close, .btn-close-modal').forEach(btn => {
        btn.addEventListener('click', closeModal);
    });

    // Boutons de dictÃ©e vocale microphone pour modification par IA
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

    // Bouton terminer sur le bandeau de dictÃ©e vocale en direct
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

    // Bouton d'enregistrement de la clÃ© API Gemini
    const btnSaveKey = document.getElementById('btn-save-api-key');
    if (btnSaveKey) {
        btnSaveKey.addEventListener('click', () => {
            const key = document.getElementById('gemini-api-key').value.trim();
            appState.geminiApiKey = key;
            localStorage.setItem('batipercheron_gemini_api_key', key);
            showToast("ClÃ© API Gemini enregistrÃ©e localement !", "success");
        });
    }

    // Bouton de rÃ©daction automatique par IA (Gemini)
    const btnAiGenerate = document.getElementById('btn-ai-generate');
    if (btnAiGenerate) {
        btnAiGenerate.addEventListener('click', handleAIGenerate);
    }

    // Bouton de copie Ã  l'identique (sans IA)
    const btnCopyIdentical = document.getElementById('btn-copy-identical');
    if (btnCopyIdentical) {
        btnCopyIdentical.addEventListener('click', handleCopyIdentical);
    }

    // Bouton de tÃ©lÃ©chargement du PDF
    const btnDownloadPdf = document.getElementById('btn-download-pdf');
    if (btnDownloadPdf) {
        btnDownloadPdf.addEventListener('click', handleDownloadPdf);
    }

    // Bouton de tÃ©lÃ©chargement Word
    const btnDownloadWord = document.getElementById('btn-download-word');
    if (btnDownloadWord) {
        btnDownloadWord.addEventListener('click', handleDownloadWord);
    }

    // Modal RÃ©glages IA
    const btnAiSettings = document.getElementById('btn-ai-settings');
    const aiSettingsModal = document.getElementById('ai-settings-modal');
    const aiCustomInstructionsInput = document.getElementById('ai-custom-instructions');
    const btnSaveAiSettings = document.getElementById('btn-save-ai-settings');

    if (btnAiSettings && aiSettingsModal) {
        btnAiSettings.addEventListener('click', () => {
            if (aiCustomInstructionsInput) {
                aiCustomInstructionsInput.value = appState.customAIInstructions || '';
            }
            aiSettingsModal.classList.add('active');
        });
    }

    if (btnSaveAiSettings) {
        btnSaveAiSettings.addEventListener('click', () => {
            const instructions = aiCustomInstructionsInput ? aiCustomInstructionsInput.value.trim() : '';
            appState.customAIInstructions = instructions;
            localStorage.setItem('batipercheron_custom_ai_instructions', instructions);
            showToast("Instructions IA enregistrÃ©es !", "success");
            aiSettingsModal.classList.remove('active');
        });
    }

    // Toggle flÃ¨che Ã©diteur
    const btnToggleEditor = document.getElementById('btn-toggle-editor');
    const editorWrapper = document.getElementById('editor-content-wrapper');
    if (btnToggleEditor && editorWrapper) {
        btnToggleEditor.addEventListener('click', (e) => {
            e.preventDefault();
            editorWrapper.classList.toggle('collapsed');
        });
    }
}

/* ==========================================================================
   LOGIQUE MÃ‰TIER & ACTIONS
   ========================================================================== */

// CrÃ©er un nouveau projet
function handleNewProject() {
    if (confirm('Voulez-vous crÃ©er un nouveau compte rendu ? Le projet en cours sera conservÃ© dans l\'historique local.')) {
        const newProj = createNewProjectData('Nouveau Compte Rendu');
        appState.projects[newProj.id] = newProj;
        appState.currentProjectId = newProj.id;
        appState.activeBlockId = 'intro';
        
        saveProjectsToLocalStorage();
        loadCurrentProjectIntoUI();
        renderSidebarProjects();
        renderBlockList();
        
        switchTab('edit');
        showToast('Nouveau projet crÃ©Ã©', 'success');
    }
}

// Mise Ã  jour des mÃ©tadonnÃ©es
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

// Commuter d'onglet (Ã‰diteur vs Note vocale)
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

// SÃ©lectionner un bloc dans la barre latÃ©rale pour l'Ã©diter
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
        // Charger dans les formulaires de l'Ã©diteur
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

// Mettre Ã  jour le texte du bloc actif
function updateActiveBlockData(key, value) {
    const proj = getActiveProject();
    if (!proj) return;

    const block = proj.blocks.find(b => b.id === appState.activeBlockId);
    if (block) {
        block[key] = value;
        
        // Si l'utilisateur a Ã©crit du texte et que le bloc Ã©tait "vide", on le passe en "En cours"
        if (key !== 'status' && block.status === 'empty' && value.trim() !== '') {
            block.status = 'progress';
            document.getElementById('editor-block-status').value = 'progress';
            renderBlockList();
        }

        saveProjectsToLocalStorage();
        updateLivePreview();
    }
}

// Ajouter un bloc personnalisÃ©
function handleAddBlock() {
    const title = prompt('Saisissez le titre du nouveau bloc (ex: BÃ¢tisse 2, Grange, Piscine...) :');
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

    // InsÃ©rer avant le dernier bloc (Conclusion) s'il existe, sinon en fin de liste
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
    showToast(`Bloc "${title.trim()}" ajoutÃ©`, 'success');
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

    // Mettre Ã  jour l'en-tÃªte de l'Ã©diteur si c'est le bloc actif
    if (appState.activeBlockId === blockId) {
        const display = document.getElementById('active-block-title-display');
        if (display) display.innerText = block.title;
    }

    saveProjectsToLocalStorage();
    renderBlockList();
    updateLivePreview();
    showToast(`Bloc renommÃ© en Â«Â ${block.title}Â Â»`, 'success');
}

// Supprimer un bloc
function deleteBlock(blockId, e) {
    if (e) e.stopPropagation(); // Ã‰viter de sÃ©lectionner le bloc pendant le clic sur supprimer

    const proj = getActiveProject();
    const blockIndex = proj.blocks.findIndex(b => b.id === blockId);
    
    if (blockIndex === -1) return;
    const blockTitle = proj.blocks[blockIndex].title;

    if (confirm(`Voulez-vous vraiment supprimer le bloc "${blockTitle}" ? Toutes les donnÃ©es qu'il contient seront perdues.`)) {
        proj.blocks.splice(blockIndex, 1);
        saveProjectsToLocalStorage();
        
        renderBlockList();
        
        // Si on a supprimÃ© le bloc actif, on sÃ©lectionne le premier bloc restant ou on vide l'Ã©diteur
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
        showToast(`Bloc "${blockTitle}" supprimÃ©`, 'info');
    }
}

// Ordonner les blocs (monter/descendre) avec rebouclage (wrap around)
function moveBlock(blockId, direction, e) {
    if (e) e.stopPropagation();

    const proj = getActiveProject();
    const index = proj.blocks.findIndex(b => b.id === blockId);
    if (index === -1) return;

    if (proj.blocks.length <= 1) return; // Rien Ã  dÃ©placer

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

    // Ã‰change des Ã©lÃ©ments dans le tableau
    const temp = proj.blocks[index];
    proj.blocks[index] = proj.blocks[targetIndex];
    proj.blocks[targetIndex] = temp;

    saveProjectsToLocalStorage();
    renderBlockList();
    updateLivePreview();
}

/* ==========================================================================
   SYSTÃˆME DE TRANSCRIPTION & DISPATCHER (TAB 1)
   ========================================================================== */



/* ==========================================================================
   CHARGEMENT ET RENDU DE L'INTERFACE UI
   ========================================================================== */

function loadCurrentProjectIntoUI() {
    const proj = getActiveProject();
    if (!proj) return;

    // Charger les mÃ©tadonnÃ©es dans les inputs de gauche
    document.getElementById('meta-client-name').value = proj.clientName || '';
    document.getElementById('meta-visit-address').value = proj.visitAddress || '';
    document.getElementById('meta-visit-date').value = proj.visitDate || '';
    document.getElementById('meta-consultant').value = proj.consultantName || 'Fabrice Mauger - EURL BATI PERCHERON';

    // Charger la transcription dans la zone de texte
    document.getElementById('transcription-textarea').value = proj.transcription || '';

    // SÃ©lectionner le premier bloc par dÃ©faut
    if (proj.blocks && proj.blocks.length > 0) {
        // S'assurer que le bloc actif existe toujours, sinon prendre le premier
        const activeExists = proj.blocks.some(b => b.id === appState.activeBlockId);
        if (!activeExists) {
            appState.activeBlockId = proj.blocks[0].id;
        }
        selectBlock(appState.activeBlockId);
    }



    // Mettre Ã  jour la prÃ©visualisation finale A4
    updateLivePreview();
}

// Rendre la liste des blocs dans la barre latÃ©rale gauche (Sommaire)
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
            statusLabel = 'TerminÃ©';
        }

        const item = document.createElement('div');
        item.className = `block-item ${isActive ? 'active' : ''}`;
        item.setAttribute('data-block-id', block.id);
        item.addEventListener('click', () => {
            selectBlock(block.id);
            switchTab('edit'); // Rediriger automatiquement vers l'onglet d'Ã©dition si on clique sur un bloc
        });

        // Contenu du bloc item
        item.innerHTML = `
            <div class="block-item-info">
                <div class="block-title" title="${block.title}">${block.title}</div>
            </div>
            <div class="block-item-actions">
                <button class="block-item-btn btn-rename-block" title="Renommer">✏️</button>
                <button class="block-item-btn btn-delete-block" title="Supprimer">🗑️</button>
                <button class="block-item-btn btn-move-up" title="Monter">⬆️</button>
                <button class="block-item-btn btn-move-down" title="Descendre">⬇️</button>
            </div>
        `;

        // Ã‰vÃ©nements boutons actions
        item.querySelector('.btn-rename-block').addEventListener('click', (e) => renameBlock(block.id, e));
        item.querySelector('.btn-move-up').addEventListener('click', (e) => moveBlock(block.id, 'up', e));
        item.querySelector('.btn-move-down').addEventListener('click', (e) => moveBlock(block.id, 'down', e));
        item.querySelector('.btn-delete-block').addEventListener('click', (e) => deleteBlock(block.id, e));

        listContainer.appendChild(item);
    });
}



// La bibliothÃ¨que de modÃ¨les types a Ã©tÃ© retirÃ©e

/* ==========================================================================
   MISE Ã€ JOUR DE LA PRÃ‰VISUALISATION DU RAPPORT A4 (PANNEAU DROIT)
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
                <p>Aucun projet actif. CrÃ©ez un nouveau projet pour commencer.</p>
            </div>
        `;
        return;
    }

    // Formater la date en franÃ§ais
    let formattedDate = 'Non renseignÃ©e';
    if (proj.visitDate) {
        const parts = proj.visitDate.split('-');
        if (parts.length === 3) {
            formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
    }

    // Vider le conteneur d'aperÃ§u
    previewContainer.innerHTML = '';

    // Liste pour suivre les pages crÃ©Ã©es
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

    // CrÃ©er la premiÃ¨re page
    // Créer la première page
    let currentPage = createNewPage();

    // Rendre l'en-tête et la fiche client sur la Page 1
    const headerHtml = `
        <div class="doc-header">
            <img src="data:image/jpeg;base64,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/9oADAMBAAIAAwAAACHzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzy/8A/rnrU88884j/AP8AzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzvHTD3/x/b7rz/wA8z++888sGf8a9888r+8PMPLMPesb+8888888888888888888888888888888888888/1Q/I888j3zf/XJHcP8888V+8s6884e18H8/wDvLNfK/PPP8svssvOvsruutOmuvPPPPPPPPPPPPPPPPPPeL84wXbU8285br1vD/PPPFfvPrfPKO/8Azzz/AO8888r888bkk0w8bEDgPpYfPIA888888888888888888pFd3x88t6y/qe88Q+/8888V/wCF3/PEfH9PPP8A7zzzyvzzzjxxzxyzyzzyzzyzxzzzzzzzzzzzzzzzzzrvM100NlXt9+//AM88sVj8888V+88/35MMqq88/wDvPPPK/PPPwY64S7Wz68x0dcEy45b4F/PPPPPPPPPPP/PPPPPP8748/wB7vzzzfzzzzxX7zjd8j7yrbXz/AO8888r888eefvf+v/O+ePPvPev+POP+88888888888/888888/vL3Ll/P8Act/PPPPOFseCJ+qtPOvbPMLPvPML/vPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOs89/wD/AD3XsJ33888zc8888888888888888888888888888888888888888888888888888888888888888vuOugvr4nv/APPPJ/Lt7jB5nMzHNblzKN/PM13DTP3KXvP/ANav+QzOxvwy/Xzid0//AO+fS88Mc88888888r888Bj/AL9//wDzy77zxf8A8Vc8D88+8U/89U6fX888+8r88/8AFKvFvPvK/wDyj/w+fzyn/Tzbfzzzzzzzzzzz/wA88E//AP172/PO/PPF/wDx9TwP7rzxT/xdfj/zzzzzy/77/wAUq8X+88r/APL8PPn/ADzz53zu/wC8888888888879kLR51b1zJFR888X/AO3PPIPP/PFOxNfP+/PPPPPK/fbPFKvFPHvK/wDQzy7z/wA88Xc88RM888888888887+02847/8APPPP/PPF/wDzzzwPzzzxT9O/Tnrzzzzzyvzz/wAUq8W888r/AK/sLF/PPPPt/PP/AJTzzzzzzzzzzz7y792vfzzzz/zzxf8A8888D84/8U/sdv8AP2/PN9fK/PP/ABSrxbz/AEr/APGPtyBNPNu/PPPHPfPPPPPPPPPPPPPLP3t//wD/AP8A/PLj/wDzyyxwxz+49/y75/w8w23x8x7y8/74+wwyywzzzzxw+me1z43zzx3zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/2gAMAwEAAgADAAAAEPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOPnrASHPPPPORvvvPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOvxhjxQks89+KvOOP/APzzyx6zxPDzzyp3xqEA8FTQn73zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzylcYRbzzzxDgzxm9Txbzzzzz3z6/zzhvHzPymrzxX3zzzzzP/AP8A/wDTPPefPfXtfPzzzzzzzzzzzzzzzzzy/rwmX+dP0wDzs8F/yrzzzzz3z7Tzytrzzzymrzzz3zzzy0mKY4L3Y0T1u7y0U7zzzzzzzzzzzzzzzzzysffwvzzPvOy//wA8W/688888/t7Y08tg8188pq88898888w088088888888480888880888888888887KAfv/gvrwtcds888s3588888988cWsM+to88pq88898888EHF839D10M4YvTeVFET0u088888888888q888888+UoZ+sP0884M888888984c2gf89mU8pq88898888ffc8cfs8fvfs8se/s/Of8AP/PPPPPPPPPPPvPPPPPPquEPF3rP89HPPPPOMf8AzFRkLTzthDyrD3zznHXzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzyv7zDzD6gKj+xzzy2lzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzyg89+oonzln7zzwTz/q9l3frk5le9MX333z4Vx+3S3D/y3F/7GQ7rx2J6VvzxZcz7/wD6X8sN988888888+88878I00qe887/APPKffKPaqPPP/AlvKPf5bfPPF/gvPPAvPwl/P8Az0HzxPzlzzy8LRIjTzzzzzzzzzzyrzzza54xWrrDCbzzyn3yp6q3/vzwJbyfX1Pzzzzz4b//AIC8/CU/089B8qK4g1888oXUhT388888888889NnekX3fgjVTTz888p9ie8qb8p88CUZ38uW88888+TPPMC8/CV8X89Bsy8/C0888h8Usgm888888888884zW3w0o+8888+888p9888qo8888CWpi8rQ88888+C888C8/CX8889BsAysB2885EUU86A28888888888sP8/o/Me8888+888p9888qo8818CW8ol8Fx8863+C888C8/CX8189B84Ie4788zN8U88eU88888888888888suvU++++k88/Os888tNOMcvus8vPc8NI3/APLTX/LHv7zjjrfDHHPPjfDHzL/L/wDzzy/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz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" class="doc-logo-img" alt="Bati Percheron">
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

    // RÃ©cupÃ©rer les blocs de contenu non vides
    const activeBlocks = proj.blocks.filter(block => block.content && block.content.trim().length > 0);

    if (activeBlocks.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.cssText = 'text-align: center; color: var(--color-text-light); font-style: italic; margin: 4rem 0;';
        emptyMsg.innerHTML = 'Aucun contenu rÃ©digÃ© pour le moment. Saisissez du texte dans l\'Ã©diteur de blocs pour le voir s\'afficher ici.';
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
                // Si le titre de la section dÃ©passe, on la dÃ©place sur une nouvelle page
                currentPage.contentWrapper.removeChild(sectionEl);
                currentPage = createNewPage();
                currentPage.contentWrapper.appendChild(sectionEl);
            }
            
            // DÃ©couper le contenu en paragraphes
            const paragraphs = block.content.split(/\n+/).filter(p => p.trim().length > 0);
            
            paragraphs.forEach(paraText => {
                const paraEl = document.createElement('div');
                paraEl.className = 'doc-section-text';
                paraEl.innerHTML = linkify(escapeHTML(paraText));
                
                // Tenter d'ajouter le paragraphe
                sectionContent.appendChild(paraEl);
                
                if (isPageOverflowing(currentPage.element)) {
                    // DÃ©bordement dÃ©tectÃ© ! On le retire du conteneur courant
                    sectionContent.removeChild(paraEl);
                    
                    // La section est-elle le premier et unique bloc de cette page ?
                    const sectionsOnPage = currentPage.contentWrapper.querySelectorAll('.doc-section');
                    const isSectionFirstOnPage = (sectionsOnPage.length === 1);
                    
                    if (isSectionFirstOnPage) {
                        // DÃ©jÃ  en haut de page, on doit couper
                        const isPageEmpty = (currentPage.contentWrapper.children.length === 1 && sectionContent.children.length === 0);
                        
                        if (isPageEmpty) {
                            // Garder le paragraphe pour Ã©viter une boucle infinie
                            sectionContent.appendChild(paraEl);
                        } else {
                            if (sectionContent.children.length === 0) {
                                // Titre seul, on dÃ©place toute la section
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
                        // Pas en haut de page, on dÃ©place TOUTE la section sur une nouvelle page
                        currentPage.contentWrapper.removeChild(sectionEl);
                        currentPage = createNewPage();
                        
                        currentPage.contentWrapper.appendChild(sectionEl);
                        sectionContent.appendChild(paraEl);
                        
                        // Si elle dÃ©borde toujours sur la nouvelle page, on doit la couper
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

    // Tous les blocs sont placÃ©s. Mettre Ã  jour tous les numÃ©ros de page avec le nombre total dÃ©finitif
    const totalPagesCount = pages.length;
    pages.forEach((pageObj, idx) => {
        const pageNum = idx + 1;
        const updatedFooter = createPageFooter(pageNum, totalPagesCount);
        pageObj.element.replaceChild(updatedFooter, pageObj.footer);
        pageObj.footer = updatedFooter;
    });

    // Mettre Ã  jour le badge du nombre de pages dans l'interface
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

    // Nom de fichier propre basÃ© sur le nom du client et la date
    const clientClean = (proj.clientName || 'SansNom').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `CompteRendu_${clientClean}_${proj.visitDate || 'date'}.json`;

    // Si le navigateur supporte l'Ã©criture directe de fichiers (Chrome / Edge)
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
            showToast('Fichier enregistrÃ© avec succÃ¨s dans OneDrive', 'success');
        } catch (err) {
            // Si l'utilisateur annule, on ne fait rien
            if (err.name !== 'AbortError') {
                console.error("Erreur d'Ã©criture de fichier", err);
                showToast("Ã‰chec de l'enregistrement direct. Tentative de tÃ©lÃ©chargement classique...", "warning");
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
    showToast('Fichier tÃ©lÃ©chargÃ© (vÃ©rifiez votre dossier TÃ©lÃ©chargements)', 'success');
}

function handleImportJSON(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const importedData = JSON.parse(evt.target.result);
            
            // Validation trÃ¨s sommaire du schÃ©ma
            if (!importedData.id || !importedData.blocks || !Array.isArray(importedData.blocks)) {
                throw new Error('Format de fichier invalide (propriÃ©tÃ©s manquantes)');
            }

            // GÃ©nÃ©rer un nouvel ID pour Ã©viter d'Ã©craser un projet s'il s'agit d'un doublon
            // ou Ã©craser s'il a le mÃªme id
            const id = importedData.id;
            appState.projects[id] = importedData;
            appState.currentProjectId = id;

            saveProjectsToLocalStorage();
            loadCurrentProjectIntoUI();
            renderSidebarProjects();
            renderBlockList();
            
            switchTab('edit');
            showToast('Projet importÃ© et chargÃ© avec succÃ¨s !', 'success');

        } catch (err) {
            console.error(err);
            alert('Impossible de charger le fichier. Assurez-vous qu\'il s\'agit d\'un fichier JSON de sauvegarde Bati Percheron valide.');
            showToast('Ã‰chec de l\'importation', 'error');
        }
    };
    reader.readAsText(file);
    // RÃ©initialiser la valeur de l'input file pour permettre d'importer le mÃªme fichier Ã  la suite
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
            let formattedDate = 'Non spÃ©cifiÃ©e';
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
                showToast(`Projet chargÃ© : ${proj.clientName || 'Sans nom'}`, 'success');
            });

            tr.querySelector('.btn-delete-project').addEventListener('click', () => {
                if (confirm(`Voulez-vous vraiment supprimer dÃ©finitivement le projet de "${proj.clientName || 'Client sans nom'}" de l'historique local ?`)) {
                    delete appState.projects[proj.id];
                    
                    // Si on a supprimÃ© le projet courant
                    if (appState.currentProjectId === proj.id) {
                        const remainingIds = Object.keys(appState.projects);
                        if (remainingIds.length > 0) {
                            appState.currentProjectId = remainingIds[0];
                        } else {
                            // On en recrÃ©e un vide
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
                    showToast('Projet supprimÃ© de l\'historique local', 'info');
                }
            });

            tbody.appendChild(tr);
        });
    }

    modal.classList.add('active');
}

function renderSidebarProjects() {
    // Optionnel : on peut mettre Ã  jour des compteurs globaux de projets dans la sidebar
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
    
    let icon = 'â„¹ï¸';
    if (type === 'success') icon = 'âœ”ï¸';
    if (type === 'error') icon = 'âŒ';
    if (type === 'warning') icon = 'âš ï¸';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    // Supprimer aprÃ¨s 3.5 secondes
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
        
        // Mettre Ã  jour l'affichage du bandeau en direct
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

        // RÃ©initialiser les Ã©tats
        activeMicButton = null;
        activeTextarea = null;
        recordedSpeech = '';

        if (btn) {
            btn.classList.remove('recording');
            if (btn.id === 'btn-mic-guidelines') {
                btn.title = "Dicter des consignes de rÃ©daction pour l'IA";
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
                showToast("Consigne de guidage enregistrÃ©e !", "success");
            } else {
                showToast("Consigne vocale capturÃ©e, traitement par l'IA...", "info");
                await modifyTextWithAI(txt, instruction);
            }
        } else {
            showToast("Ã‰coute vocale arrÃªtÃ©e (aucune instruction dÃ©tectÃ©e)", "info");
        }
    };

    recognition.onerror = function(event) {
        console.error("Erreur de reconnaissance vocale", event);
        if (event.error === 'not-allowed') {
            showToast("AccÃ¨s au microphone refusÃ© par le navigateur.", "error");
        } else {
            showToast("Erreur lors de l'Ã©coute vocale : " + event.error, "error");
        }
        if (activeMicButton) {
            activeMicButton.classList.remove('recording');
            if (activeMicButton.id === 'btn-mic-guidelines') {
                activeMicButton.title = "Dicter des consignes de rÃ©daction pour l'IA";
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
        showToast("Votre navigateur ne supporte pas la dictÃ©e vocale native (essayez Google Chrome ou Edge).", "warning");
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
            button.title = "ArrÃªter la dictÃ©e de consigne";
        } else {
            button.title = "ArrÃªter et envoyer la consigne Ã  l'IA";
        }
        
        // Afficher le bandeau de dictÃ©e vocale en direct
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
                showToast("Dictez vos consignes pour l'IA (ex : 'insister sur l'humiditÃ© du salon')...", "success");
            } else {
                showToast("Dictez votre consigne (ex : 'remplace la date par le 22 avril')...", "success");
            }
        } catch (err) {
            console.error("Ã‰chec de dÃ©marrage de la reconnaissance vocale", err);
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
        showToast("Veuillez d'abord configurer votre clÃ© API Gemini dans la barre latÃ©rale pour utiliser l'IA.", "warning");
        return;
    }

    const loader = document.getElementById('ai-loading-overlay');
    const loadingText = loader ? loader.querySelector('.loading-text') : null;
    const loadingSubtext = loader ? loader.querySelector('.loading-subtext') : null;
    
    // Sauvegarder les textes du loader pour les restaurer aprÃ¨s
    const oldText = loadingText ? loadingText.innerText : "";
    const oldSubtext = loadingSubtext ? loadingSubtext.innerText : "";

    if (loadingText) loadingText.innerText = "Modification du paragraphe par l'IA...";
    if (loadingSubtext) loadingSubtext.innerText = `Prise en compte de votre consigne : "${instruction}"`;
    if (loader) loader.classList.add('active');

    const currentText = textarea.value.trim();
    const proj = getActiveProject();
    
    // MÃ©moriser la consigne pour une sauvegarde globale Ã©ventuelle
    appState.lastVocalInstruction = instruction;
    
    const block = proj.blocks.find(b => b.id === appState.activeBlockId);
    const blockTitle = block ? block.title : "ce paragraphe";

    const customInstr = appState.customAIInstructions ? `\n\nVoici les instructions globales permanentes Ã  respecter impÃ©rativement :\n"${appState.customAIInstructions}"` : '';

    const promptText = `Tu es un conseiller expert en bÃ¢timent, spÃ©cialiste bienveillant et constructif de la restauration et de la prÃ©servation du patrimoine ancien percheron.${customInstr}
Tu dois modifier ou corriger le texte actuel du bloc "${blockTitle}" en appliquant l'instruction vocale donnÃ©e par l'utilisateur.

Voici le texte actuel (qui peut Ãªtre vide) :
"${currentText}"

Voici la consigne de modification dictÃ©e par l'utilisateur :
"${instruction}"

RÃ¨gles Ã  suivre impÃ©rativement :
1. Modifie le texte existant en intÃ©grant la consigne. S'il s'agit d'une correction de date, d'adresse, de technique ou d'un ajout, fais-le proprement.
2. Si le texte actuel est vide, rÃ©dige un paragraphe rÃ©digÃ© Ã  partir de la consigne vocale fournie.
3. Conserve un ton professionnel, encourageant, constructif et optimiste quant au potentiel du bÃ¢timent. Ã‰vite le ton trop froid, austÃ¨re, alarmiste ou de "diagnostiqueur" (pas de "je", pas de salutations).
4. Ne rÃ©ponds QUE par le nouveau texte corrigÃ©. Ne mets aucune phrase d'explication, aucune introduction, aucun commentaire, ni balises markdown. Renvoie directement le texte final.`;

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
                    
                    // Nettoyer les balises Markdown si l'IA en a gÃ©nÃ©rÃ© par habitude
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
        // Au lieu d'Ã©craser immÃ©diatement, on affiche la suggestion de l'IA
        const suggestionContainer = document.getElementById('ia-suggestion-container');
        const suggestionTextarea = document.getElementById('editor-ia-suggestion');
        if (suggestionContainer && suggestionTextarea) {
            suggestionTextarea.value = cleanContentFormatting(updatedText);
            suggestionContainer.style.display = 'flex';
            // Faire dÃ©filer l'Ã©diteur pour afficher la suggestion
            document.querySelector('.editor-body').scrollTop = document.querySelector('.editor-body').scrollHeight;
        }
        showToast("Proposition de l'IA gÃ©nÃ©rÃ©e !", "success");
    } else {
        console.error("Erreur d'Ã©dition IA", lastError);
        alert(`Impossible de modifier le texte avec l'IA.\nDÃ©tails : ${lastError ? lastError.message : "Erreur inconnue"}`);
        showToast("Ã‰chec de la modification IA", "error");
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
    } else if (fileType === 'pdf') {
        readPdfFile(file);
    } else {
        showToast("Format de fichier non supportÃ© (uniquement .docx, .txt, .pdf)", "error");
    }

    // RÃ©initialiser la valeur de l'input pour pouvoir importer Ã  nouveau
    e.target.value = '';
}

function readTxtFile(file) {
    const reader = new FileReader();
    reader.onload = function(evt) {
        const text = evt.target.result;
        document.getElementById('transcription-textarea').value = text;
        
        // Mettre Ã  jour le projet actif et dÃ©clencher la preview
        const proj = getActiveProject();
        if (proj) {
            proj.transcription = text;
            saveProjectsToLocalStorage();
            updateLivePreview();
        }
        
        showToast("Transcription .txt importÃ©e !", "success");
    };
    reader.readAsText(file);
}

function readDocxFile(file) {
    if (typeof mammoth === 'undefined') {
        showToast("La bibliothÃ¨que Word n'est pas encore chargÃ©e (vÃ©rifiez votre connexion internet)", "warning");
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

// Recopier la transcription brute à l'identique (bypass de l'IA)
function handleCopyIdentical() {
    const proj = getActiveProject();
    if (!proj) return;

    const transcription = (proj.transcription || '').trim();
    if (!transcription) {
        showToast("Veuillez d'abord coller ou importer une transcription de note vocale.", "warning");
        return;
    }

    if (confirm("Voulez-vous vraiment remplacer le document actuel par un seul bloc contenant votre transcription brute ?")) {
        proj.blocks = [
            {
                id: 'raw_' + Date.now(),
                title: '',
                content: transcription,
                status: 'draft'
            }
        ];
        appState.activeBlockId = proj.blocks[0].id;
        
        saveProjectsToLocalStorage();
        loadCurrentProjectIntoUI();
        renderBlockList();
        switchTab('edit');
        showToast("Transcription recopiée avec succès !", "success");
    }
}

// Lancer la génération avec l'IA
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

    const customInstr = appState.customAIInstructions ? `\n\nVoici les instructions globales permanentes (règles de rédaction) à respecter impérativement :\n"${appState.customAIInstructions}"` : '';

    const promptText = `${customInstr}
Tu es l'assistant rédactionnel de Fabrice Mauger, artisan spécialisé dans la restauration du bâti ancien (Bâti Percheron, Parc Naturel Régional du Perche). À partir de la transcription vocale d'une visite conseil qu'il a réalisée chez un client (le plus souvent dans le cadre d'un projet d'acquisition ou de rénovation d'un bien ancien), tu rédiges un compte-rendu de visite conseil complet et détaillé, en français.

## Consigne impérative sur le niveau de détail
Ne produis jamais une synthèse courte. Le compte-rendu doit reprendre l'intégralité des observations, échanges techniques, diagnostics, hypothèses, solutions envisagées, variantes évoquées, points de vigilance, réserves et recommandations formulés pendant la visite, même si cela donne un document long. Si un point a été développé longuement à l'oral (plusieurs hypothèses, plusieurs solutions alternatives, plusieurs variantes graduées), il doit être développé avec la même richesse à l'écrit. Ne résume jamais un raisonnement détaillé en une phrase courte, et ne sautes jamais une étape intermédiaire d'un raisonnement pour ne garder que les deux extrêmes (par exemple : ne pas se limiter à « surveillance simple » et « réfection lourde » si une solution intermédiaire chiffrée a été évoquée à l'oral).

## Checklist anti-oubli : lots techniques à vérifier systématiquement
Avant de considérer le compte-rendu terminé, vérifie qu'aucun des lots suivants n'a été oublié s'il a été abordé, même brièvement, pendant la visite : structure/maçonnerie, charpente, couverture, isolation, ventilation, menuiseries et condensation, chauffage, plomberie/sanitaires, électricité, sols et revêtements, enduits et humidité, aménagements intérieurs, aménagements extérieurs, assainissement.
Un sujet évoqué en une seule phrase à l'oral (ex : un peu de condensation sur les fenêtres, une ventilation jugée insuffisante) doit malgré tout donner lieu à son propre paragraphe ou sous-titre dans le compte-rendu, même court. Ne jamais fusionner silencieusement un lot technique dans un autre sujet pour gagner de la place, et ne jamais l'omettre au motif qu'il n'a pas donné lieu à une décision ou à des travaux immédiats.

## Structure générale
1. Titre : « COMPTE-RENDU DE VISITE CONSEIL »
2. Objet (une ligne résumant la nature du bien et l'objectif de la visite)
3. Date de la visite
4. Contexte de la visite : qui a demandé la visite, dans quel cadre (acquisition, projet de rénovation…), composition du bien, objectifs précis de la visite.
   - Toujours inclure une clause de cadrage du type : la visite constitue un avis technique fondé sur des observations visuelles, elle ne se substitue pas à une étude réalisée par un bureau d'études spécialisé, et il peut être opportun de faire intervenir un bureau d'études structure en cas de doute sur des éléments porteurs.
   - Ne pas mentionner le prix d'acquisition du bien, ni les circonstances personnelles ou familiales du client (séparation, situation de vie, etc.), même si elles ont été évoquées pendant la visite. Ces éléments n'ont pas leur place dans un compte-rendu technique, sauf s'ils ont une incidence directe et utile sur le dimensionnement d'un équipement (ex : nombre de chambres/occupants prévu pertinent pour l'assainissement) — dans ce cas, ne reprendre que le fait technique utile, sans le contexte personnel qui l'accompagne.
5. Corps du compte-rendu organisé en grandes sections indépendantes par zone du bâtiment, puis par lot technique à l'intérieur de chaque zone :
   - MAISON PRINCIPALE, avec un sous-titre dédié pour chaque lot technique réellement traité pendant la visite : structure et cheminée, planchers et structure d'étage, sols et revêtements (tomettes…), enduits et humidité, salle de bains, menuiseries et condensation, couverture et isolation, ouvertures de toiture. Chaque lot évoqué doit avoir son propre sous-titre, même bref — ne pas regrouper plusieurs lots sous un intitulé générique « autres observations ».
   - CHAUFFAGE, toujours en section indépendante au même niveau que « MAISON PRINCIPALE » et « DÉPENDANCES » — ne jamais l'enterrer comme sous-partie de la couverture/isolation même si le sujet a été abordé en lien avec celle-ci à l'oral. Présenter le système actuel, le système envisagé, le lien explicite avec d'autres travaux si pertinent (ex : isolation de toiture à reprendre en amont d'une pompe à chaleur), et nommer l'artisan ou l'entreprise cité comme interlocuteur.
   - DÉPENDANCES, chaque dépendance traitée individuellement (couverture, charpente, cheminée éventuelle, état général), puis les projets d'aménagement envisagés pour ces dépendances.
   - AMÉNAGEMENTS EXTÉRIEURS, toujours en section indépendante — ne jamais la fusionner avec les observations intérieures de la maison principale. Inclut notamment l'assainissement, les abords, le terrain.
6. Conclusion générale : synthèse rédigée en prose, qui rappelle les points les plus significatifs, hiérarchise implicitement leur importance, et resitue le potentiel global du bien.

## Distinguer systématiquement, pour chaque sujet traité
Pour chaque désordre ou sujet technique abordé, distingue clairement dans la rédaction :
- les constats observés directement pendant la visite ;
- les hypothèses ou causes possibles (si plusieurs causes coexistent, les présenter toutes plutôt que d'en retenir une seule arbitrairement — « le phénomène semble multifactoriel : … ») ;
- les recommandations et solutions envisagées, y compris les solutions ou essais simples et peu coûteux suggérés avant d'engager des travaux plus lourds (ex : tester un relevage temporaire du foyer avant de modifier la hotte) ;
- les travaux à prévoir en priorité ou en urgence ;
- les travaux pouvant être différés, en précisant si possible un horizon de temps ou une condition de déclenchement (ex : « si des fissures structurelles apparaissent »).

## Restitution des éléments rassurants
Quand un élément observé pendant la visite permet d'écarter une inquiétude ou de relativiser un désordre (ex : un appui ou un corbeau qui ne présente aucune rupture, un mouvement jugé ancien et stabilisé), le dire explicitement et expliquer en quoi cet élément est rassurant pour le client (« si cet élément avait commencé à se dégrader, le niveau d'inquiétude serait nettement supérieur »), plutôt que de se contenter de mentionner l'absence de désordre en passant.

## Hiérarchisation et niveaux de gravité
Pour chaque désordre technique, préciser systématiquement :
- s'il présente ou non un caractère d'urgence ou un risque structurel à court terme ;
- s'il s'agit d'un phénomène ancien et lent ou récent et actif ;
- si les travaux correspondants peuvent être différés ou doivent être programmés à moyen terme.
Quand plusieurs niveaux d'intervention sont possibles, les présenter sous forme de variantes graduées complètes, du plus léger au plus lourd (ex : surveillance simple / stabilisation légère / renforcement intermédiaire / réfection lourde), en indiquant pour chacune les implications (coût, intrusivité, durabilité). Conserve impérativement les dimensions ou sections techniques précises annoncées à l'oral pour chaque variante, même approximatives (ex : remplacement d'une poutre actuellement de l'ordre de 30x30 cm par une section de l'ordre de 40x40 cm) — ces chiffres sont souvent l'information la plus utile au client et ne doivent jamais être résumés ou supprimés au profit d'une description seulement qualitative.

## Mentions nominatives des professionnels
Chaque fois qu'un professionnel ou une entreprise est cité pendant la visite comme interlocuteur pour un lot de travaux (maçon, chauffagiste, couvreur, menuisier, fournisseur de matériaux…), le mentionner nommément dans la section correspondante du compte-rendu, avec sa localisation si elle a été donnée.

## Autres points de vigilance rédactionnels
- Rédaction en paragraphes liés et argumentés, pas en listes de phrases courtes juxtaposées, sauf pour énumérer des variantes graduées ou une liste de projets/lots où une liste à puces reste plus lisible.
- Ton technique, factuel, mesuré, à la troisième personne ou en formulations impersonnelles (« il a été observé que… », « il apparaît que… », « il conviendra de… »). Pas de tournures commerciales ni emphatiques.
- Toujours distinguer ce qui a été observé directement pendant la visite et ce qui a été rapporté par le client/propriétaire sans vérification directe (ex : un contrôle SPANC mentionné par le client doit être présenté comme « selon les informations communiquées », avec la précision que cela n'a pas fait l'objet d'une vérification directe).
- Mettre en valeur les découvertes faites pendant la visite elle-même quand elles ont une portée pour le projet du client (ex : une partie de toiture non reprise alors qu'elle n'était pas visible depuis les pièces de vie) — expliquer explicitement en quoi elles sont importantes pour les décisions à venir du client, ne pas les noyer dans le reste du texte.
- Quand plusieurs sujets techniques sont liés entre eux (ex : choix d'un système de chauffage par pompe à chaleur et nécessité de reprendre l'isolation de la couverture en amont), établir explicitement ce lien dans le texte plutôt que de traiter les sujets de façon cloisonnée.
- Anticiper les conséquences indirectes d'une évolution du projet (ex : si la capacité d'accueil du bien augmente via l'aménagement des dépendances, vérifier la compatibilité des équipements existants comme l'assainissement, et recommander une consultation des organismes compétents si nécessaire).

## Conclusion générale
Rédiger une conclusion en plusieurs paragraphes de prose (pas une simple liste à puces de priorités) qui :
- resitue le bien dans son contexte (bâti ancien, plusieurs campagnes de travaux successives) ;
- rappelle que les désordres observés relèvent principalement du vieillissement naturel et de choix techniques antérieurs ;
- précise si la visite a permis d'écarter un risque structurel immédiat ou un obstacle majeur au projet ;
- rappelle les deux ou trois points les plus significatifs relevés pendant la visite, en particulier ceux qui ont une incidence directe sur les choix du client (ex : lien entre isolation de toiture et choix de chauffage) ;
- conclut sur le potentiel global (patrimonial, architectural, fonctionnel) du bien.

## À ne jamais faire
- Ne jamais produire une synthèse courte ou un résumé allégé.
- Ne jamais supprimer une hypothèse ou une variante évoquée à l'oral au prétexte de simplifier, y compris les variantes intermédiaires chiffrées.
- Ne jamais affirmer une cause unique quand plusieurs causes ont été évoquées.
- Ne jamais omettre la clause de cadrage précisant que l'avis est un avis technique visuel, non un rapport de bureau d'études.
- Ne jamais transformer une information rapportée par le client en fait vérifié.
- Ne jamais omettre un lot technique mentionné pendant la visite, même traité brièvement à l'oral (ex : condensation sur les menuiseries, ventilation) — chaque lot abordé doit apparaître avec son propre sous-titre.
- Ne jamais regrouper le chauffage ou l'assainissement/aménagements extérieurs dans une section consacrée à un autre sujet — ce sont des sections indépendantes au même niveau que « MAISON PRINCIPALE » et « DÉPENDANCES ».
- Ne jamais mentionner le prix d'acquisition ou les circonstances personnelles/familiales du client dans le compte-rendu.

## Note sur l'entrée
La transcription fournie en entrée est issue d'une dictée vocale : elle peut contenir des approximations de termes techniques (orthographe, mots mal transcrits). Il convient de les corriger silencieusement en t'appuyant sur le contexte du bâti ancien, sans signaler la correction dans le compte-rendu final.

---
INFORMATIONS SPÉCIFIQUES À CETTE VISITE :
- Client : ${proj.clientName || 'Non spécifié'}
- Date de visite : ${formattedDate}
- Adresse du bien : ${proj.visitAddress || 'Non renseignée'}

Consignes spécifiques de l'utilisateur :
"${guidelines || 'Aucune consigne spécifique.'}"

Transcription brute de la note vocale :
"${transcription}"

---
RÈGLES DE FORMATAGE TECHNIQUES OBLIGATOIRES POUR L'APPLICATION (NE PAS DÉROGER) :
1. PARAGRAPHES AÉRÉS : Divise tes explications en plusieurs paragraphes avec des sauts de ligne réguliers.
2. LISTES : Utilise exclusivement des tirets simples ("- ") suivis d'un seul espace en début de ligne.
3. AUCUN FORMATAGE MARKDOWN : Pas d'astérisques (** ou *). Rédige en texte brut simple.

Tu dois impérativement renvoyer le résultat sous la forme d'un TABLEAU JSON (array), sans aucun autre texte. Chaque élément du tableau est un bloc avec les champs "id", "title" (en majuscules, ex: CHAUFFAGE, MAISON PRINCIPALE - TOITURE, etc.), et "content" (paragraphes rédigés). Exemple de format attendu :
[
  { "id": "intro", "title": "OBJET DE LA VISITE", "content": "..." },
  { "id": "chauffage", "title": "CHAUFFAGE", "content": "..." }
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
    const regex = /(?:\s*,\s*|\s*-\s*|\s+)(\d{5}(?:\s+[a-zA-Z\s-]+)?)$/;
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


// Générer et télécharger le document Word (.docx)
async function handleDownloadWord() {
    const proj = getActiveProject();
    if (!proj) {
        showToast("Aucun projet actif", "error");
        return;
    }

    const clientClean = (proj.clientName || 'SansNom').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const wordFilename = "CompteRendu_$clientClean_${proj.visitDate || 'date'}.docx";

    const btnDownload = document.getElementById('btn-download-word');
    const oldBtnText = btnDownload ? btnDownload.innerText : '';
    if (btnDownload) {
        btnDownload.disabled = true;
        btnDownload.innerText = "⏳ Génération...";
    }

    try {
        const previewElement = document.getElementById('document-preview-target');
        const clone = previewElement.cloneNode(true);
        
        // Remove pagination elements for Word
        const footers = clone.querySelectorAll('.doc-page-footer');
        footers.forEach(f => f.remove());
        
        // Set hardcoded width for Word rendering of logo
        const logos = clone.querySelectorAll('.doc-logo-img');
        logos.forEach(l => l.remove());
        
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Compte Rendu</title>
                <style>
                    body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #000; }
                    h1, h2, h3 { color: #534b3e; }
                    .document-title { font-size: 18pt; text-align: center; margin-bottom: 24pt; font-weight: bold; }
                    .metadata-section { margin-bottom: 24pt; }
                    .block-title { font-size: 14pt; border-bottom: 1px solid #b09b71; padding-bottom: 4pt; margin-top: 16pt; margin-bottom: 8pt; }
                    .block-content { text-align: justify; line-height: 1.5; margin-bottom: 16pt; }
                    .footer-text { text-align: center; font-size: 9pt; color: #666; margin-top: 32pt; }
                </style>
            </head>
            <body>
                ${clone.innerHTML}
            </body>
            </html>
        `;

        if (typeof htmlDocx === 'undefined') {
            throw new Error("La librairie html-docx-js n'a pas pu être chargée.");
        }

        const converted = htmlDocx.asBlob(htmlContent);
        
        const url = URL.createObjectURL(converted);
        const a = document.createElement('a');
        a.href = url;
        a.download = wordFilename;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);

        showToast("Document Word téléchargé !", "success");
    } catch (error) {
        console.error("Erreur génération Word", error);
        alert("Une erreur est survenue lors de la création du Word : " + error.message);
    } finally {
        if (btnDownload) {
            btnDownload.disabled = false;
            btnDownload.innerText = oldBtnText;
        }
    }
}

async function readPdfFile(file) {
    showToast("Extraction du texte PDF en cours...", "info");
    
    try {
        if (!window.pdfjsLib) {
            throw new Error("Librairie PDF.js non chargée");
        }
        
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
        let fullText = "";
        
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(" ");
            fullText += pageText + "\n\n";
        }

        if (!fullText.trim()) {
            showToast("Le PDF ne contient pas de texte lisible (peut-être un document scanné).", "warning");
            return;
        }

        document.getElementById('transcription-textarea').value = fullText.trim();
        
        const proj = getActiveProject();
        if (proj) {
            proj.transcription = fullText.trim();
            saveProjectsToLocalStorage();
            updateLivePreview();
        }
        showToast("Fichier PDF importé avec succès !", "success");
    } catch (error) {
        console.error("Erreur lecture PDF :", error);
        showToast("Erreur lors de la lecture du fichier PDF.", "error");
    }
}








