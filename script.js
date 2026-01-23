document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURACIÓN DE FIREBASE ---
    const firebaseConfig = {
      apiKey: "AIzaSyAjq3rF98jp9IyH-t7vD-4VXWEozm2dr3Y",
      authDomain: "resenas-profesores-upiicsa.firebaseapp.com",
      projectId: "resenas-profesores-upiicsa",
      storageBucket: "resenas-profesores-upiicsa.appspot.com",
      messagingSenderId: "101559991030",
      appId: "1:101559991030:web:a17afefee1674bfd54cad7"
    };

    // --- INICIALIZACIÓN ---
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    const db = firebase.firestore();
    const auth = firebase.auth(); 

    // --- AUTENTICACIÓN ANÓNIMA ---
    auth.signInAnonymously()
        .then(() => {
            console.log("Sistema de seguridad activo.");
        })
        .catch((error) => {
            console.error("Error seguridad:", error);
        });

    let profesoresDataCache = [];
    let materiasUnicasCache = new Set();
    let carrerasUnicasCache = new Set();
    let currentRatings = { general: 0, claridad: 0, dificultad: 0, carga: 0 };
    let searchMode = 'profesor';

    // --- REFERENCIAS AL DOM ---
    const viewMain = document.getElementById('view-main-list');
    const viewProfesorDetail = document.getElementById('view-profesor-detail');
    const viewMateriaDetail = document.getElementById('view-materia-detail');
    const formAddReview = document.getElementById('form-add-review');
    const listaResultadosDiv = document.getElementById('lista-resultados');
    const buscador = document.getElementById('buscador');
    const starRatingInputs = document.querySelectorAll('.star-rating-input');
    const inputNombre = document.getElementById('add-nombre-profesor');
    const inputApellido = document.getElementById('add-apellido-profesor');
    const inputMateria = document.getElementById('add-materia-profesor');
    const inputCarrera = document.getElementById('add-carrera-profesor');
    const suggestionsNombre = document.getElementById('nombre-suggestions');
    const suggestionsApellido = document.getElementById('apellido-suggestions');
    const suggestionsMateria = document.getElementById('materia-suggestions');
    const chatWindow = document.getElementById('chat-window');
    const chatToggleButton = document.getElementById('chat-toggle-button');
    const chatForm = document.getElementById('chat-form');
    const chatAliasInput = document.getElementById('chat-alias');
    const chatInput = document.getElementById('chat-input');
    const editAliasBtn = document.getElementById('edit-alias-btn');
    const chatMessages = document.getElementById('chat-messages');
    const searchModeProfesorBtn = document.getElementById('search-mode-profesor');
    const searchModeMateriaBtn = document.getElementById('search-mode-materia');

    // --- HELPERS GENERALES ---
    // Normalizar: quita acentos y pasa a minúsculas (Ángel -> angel)
    const normalizarTexto = (texto) => {
        if (!texto) return "";
        return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    };

    // --- LÓGICA DE NAVEGACIÓN ---
    const mostrarVista = (vista) => {
        viewMain.style.display = 'none';
        viewProfesorDetail.style.display = 'none';
        viewMateriaDetail.style.display = 'none';
        vista.style.display = 'block';
    };
    const goBack = () => mostrarVista(viewMain);

    // --- LÓGICA DEL CHAT ---
    chatToggleButton.addEventListener('click', () => chatWindow.classList.toggle('hidden'));
    const savedAlias = localStorage.getItem('chatAlias');
    if (savedAlias) {
        chatAliasInput.value = savedAlias;
        chatAliasInput.readOnly = true;
    }
    editAliasBtn.addEventListener('click', () => {
        chatAliasInput.readOnly = false;
        chatAliasInput.focus();
    });

    auth.onAuthStateChanged((user) => {
        if (user) {
            db.collection('chat_general').orderBy('timestamp', 'desc').limit(50).onSnapshot(snapshot => {
                chatMessages.innerHTML = '';
                if (snapshot.empty) return;
                snapshot.docs.reverse().forEach(doc => {
                    const msg = doc.data();
                    const fecha = msg.timestamp ? msg.timestamp.toDate() : new Date();
                    const hora = fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                    const dia = fecha.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

                    const msgDiv = document.createElement('div');
                    msgDiv.className = 'chat-message';
                    msgDiv.innerHTML = `
                        <div><span class="alias">${msg.alias || 'Anónimo'}:</span> <span class="text">${msg.texto}</span></div>
                        <div class="timestamp">${hora} - ${dia}</div>`;
                    chatMessages.appendChild(msgDiv);
                });
                chatMessages.scrollTop = chatMessages.scrollHeight;
            });
        }
    });

    chatForm.addEventListener('submit', e => {
        e.preventDefault();
        const alias = chatAliasInput.value.trim();
        const texto = chatInput.value.trim();
        if (!auth.currentUser) return;
        if (texto && alias) {
            db.collection('chat_general').add({ 
                alias, texto, 
                userId: auth.currentUser.uid,
                timestamp: firebase.firestore.FieldValue.serverTimestamp() 
            });
            localStorage.setItem('chatAlias', alias);
            chatAliasInput.readOnly = true;
            chatInput.value = '';
        } else if (!alias) {
            alert('Ingresa un alias.');
        }
    });

    // --- BÚSQUEDA ---
    const setSearchMode = (mode) => {
        searchMode = mode;
        searchModeProfesorBtn.classList.toggle('active', mode === 'profesor');
        searchModeMateriaBtn.classList.toggle('active', mode === 'materia');
        buscador.placeholder = mode === 'profesor' ? 'Buscar profesor...' : 'Buscar materia...';
        buscador.dispatchEvent(new Event('input'));
    };
    searchModeProfesorBtn.addEventListener('click', () => setSearchMode('profesor'));
    searchModeMateriaBtn.addEventListener('click', () => setSearchMode('materia'));

    // =========================================================================
    // 1. FILTRO DE SPAM PARA PROFESORES (Actualizado con tu lista y acentos)
    // =========================================================================
    const esSpamProfesor = (profesor) => {
        // Normalizamos (sin acentos) para la comparación lógica
        const nombre = normalizarTexto(profesor.nombre);
        const apellido = normalizarTexto(profesor.apellido);
        const nombreCompleto = `${nombre} ${apellido}`;

        // 1. Patrones de Bot en Nombres/Apellidos
        const patronesBot = /^(aaa_|aafake|aaab|aaaa|aab|0000|01usuario|1primero|aabest|aahack|aahacker)/;
        if (patronesBot.test(apellido)) return true;
        if (patronesBot.test(nombre)) return true;
        
        // 2. Números
        if (/[\d]/.test(nombre) || /[\d]/.test(apellido)) return true;

        // 3. Nombres de pila genéricos usados por el bot
        // Incluimos las versiones normalizadas (sin tilde) de todos los nombres que pediste
        const nombresBot = [
            'aaaron', 'aaaaron', 'aaron', 'abril', 'adrian', 'adriana', 'agustin',
            'alba', 'alberto', 'alejandra', 'alejandro', 'alfonso', 'alfredo', 'alicia',
            'alma', 'amanda', 'amelia', 'ana', 'andres', 'angel', 'angela', 'araceli',
            'armando', 'arturo', 'aurora', 'azucena', 'carlos', 'carmen', 'emma',
            'james', 'john', 'jose', 'juan', 'lucia', 'maria', 'mary', 'olivia',
            'pedro', 'william', 'aaa', 'aab', 'aafake', 'aahacker'
        ];

        // 4. Apellidos atacados (Lista de víctimas del bot)
        // Agregamos 'adrian' aquí también por si el bot lo pone como apellido
        const apellidosSuspect = [
            'abad', 'abarca', 'abascal', 'abelardo', 'abril', 'acevedo', 'acosta',
            'acuña', 'adame', 'aguilar', 'aguilera', 'aguirre', 'alanis', 'alba', 
            'alcala', 'alcantara', 'aleman', 'alfaro', 'almanza', 'alonso', 
            'altamirano', 'alvarado', 'amador', 'amaya', 'andrade', 'angeles', 
            'aparicio', 'aquino', 'aragon', 'aranda', 'arce', 'arellano', 'arenas', 
            'arias', 'armenta', 'arriaga', 'arrieta', 'arroyo', 'ayala', 'azcarraga', 
            'garcia', 'gonzalez', 'hernandez', 'lopez', 'martinez', 'rodriguez', 
            'sanchez', 'alvarez', 'avalos', 'avila', 'adrian'
        ];

        // Lógica de intersección: Si es apellido sospechoso Y nombre genérico -> SPAM
        if (apellidosSuspect.includes(apellido)) {
            if (nombresBot.includes(nombre)) {
                 // Permitimos nombres compuestos (ej. "Juan Carlos"), el bot suele usar uno solo.
                 if (!nombre.includes(" ")) return true;
            }
        }

        // 5. Apellidos en inglés genéricos
        if (['smith', 'jones', 'brown', 'johnson', 'williams'].includes(apellido)) return true;

        // 6. Caracteres raros (Ruso, Chino, etc)
        const rawName = (profesor.nombre + " " + profesor.apellido).toLowerCase();
        if (/[^\u0000-\u00FF\u0100-\u017F\s\.\-]/.test(rawName)) return true;

        return false;
    };

    // =========================================================================
    // 2. FILTRO DE SPAM PARA MATERIAS Y RESEÑAS
    // =========================================================================
    const esMateriaSpam = (materia) => {
        if (!materia) return true;
        const mat = materia.toLowerCase().trim();

        // 1. Bloqueo de caracteres no latinos (Chino, Ruso, Árabe)
        if (/[^\u0000-\u024F\u1E00-\u1EFF\s\.\-\(\)áéíóúÁÉÍÓÚñÑüÜ0-9]/.test(mat)) return true;

        // 2. Palabras clave de Spam
        const palabrasBasura = ['mixed', 'calculus', 'physics', 'chemistry', 'economy', 'math', 'aaa_', 'test', 'fake'];
        if (palabrasBasura.some(p => mat.includes(p))) return true;

        // 3. Apellidos de profesores puestos como materia
        const apellidosEnMaterias = ['andrade', 'cruz', 'carrillo', 'solorzano'];
        if (apellidosEnMaterias.includes(mat)) return true;

        // 4. Typos de bot
        if (mat.endsWith('aa')) return true;

        return false;
    };

    db.collection("profesores").orderBy('apellido').onSnapshot(snapshot => {
        profesoresDataCache = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(prof => !esSpamProfesor(prof)); 

        materiasUnicasCache.clear();
        carrerasUnicasCache.clear();
        
        profesoresDataCache.forEach(prof => {
            prof.materias?.forEach(materia => {
                if (!esMateriaSpam(materia)) {
                    materiasUnicasCache.add(materia);
                }
            });
            prof.carreras?.forEach(carrera => carrerasUnicasCache.add(carrera));
        });
        buscador.dispatchEvent(new Event('input'));
    });

    const renderListaProfesores = (profesores) => {
        listaResultadosDiv.innerHTML = '';
        if (profesores.length === 0) {
            listaResultadosDiv.innerHTML = "<p>No se encontraron profesores.</p>";
            return;
        }
        profesores.forEach(profesor => {
            const avgRating = profesor.totalReseñas > 0 ? (profesor.sumaCalificaciones / profesor.totalReseñas) : 0;
            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `
                <h4>${profesor.apellido}, ${profesor.nombre}</h4>
                <div class="stars">${getStarsHTML(avgRating)} (${profesor.totalReseñas || 0})</div>`;
            item.addEventListener('click', () => abrirDetalleProfesor(profesor));
            listaResultadosDiv.appendChild(item);
        });
    };

    const renderListaMaterias = (materias) => {
        listaResultadosDiv.innerHTML = '';
        if (materias.length === 0) {
            listaResultadosDiv.innerHTML = "<p>No se encontraron materias.</p>";
            return;
        }
        materias.forEach(materia => {
            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `<h4>${materia}</h4>`;
            item.addEventListener('click', () => abrirDetalleMateria(materia));
            listaResultadosDiv.appendChild(item);
        });
    };
    
    buscador.addEventListener('input', () => {
        const query = normalizarTexto(buscador.value);
        if (searchMode === 'profesor') {
            const filtrados = profesoresDataCache.filter(p => 
                normalizarTexto(`${p.nombre} ${p.apellido}`).includes(query)
            );
            renderListaProfesores(filtrados);
        } else {
            const filtrados = [...materiasUnicasCache].filter(m => normalizarTexto(m).includes(query));
            renderListaMaterias(filtrados);
        }
    });

    // --- DETALLE PROFESOR ---
    const abrirDetalleProfesor = async (profesor) => {
        mostrarVista(viewProfesorDetail);
        
        const total = profesor.totalReseñas || 0;
        const avgRating = total > 0 ? (profesor.sumaCalificaciones / total) : 0;
        const avgClaridad = total > 0 ? ((profesor.sumaClaridad || 0) / total) : 0;
        const avgDificultad = total > 0 ? ((profesor.sumaDificultad || 0) / total) : 0;
        const avgCarga = total > 0 ? ((profesor.sumaCarga || 0) / total) : 0;

        viewProfesorDetail.querySelector('.summary-card').innerHTML = `
            <div class="summary-info">
                <h2>${profesor.apellido}, ${profesor.nombre}</h2>
                <p>Carreras: ${profesor.carreras?.join(', ') || 'No especificadas'}</p>
                <div class="summary-detailed-ratings">
                    <div><span class="label">Claridad al Explicar:</span> <span class="stars">${getStarsHTML(avgClaridad)}</span></div>
                    <div><span class="label">Dificultad Promedio:</span> <span class="stars">${getStarsHTML(avgDificultad)}</span></div>
                    <div><span class="label">Carga de Tareas Promedio:</span> <span class="stars">${getStarsHTML(avgCarga)}</span></div>
                </div>
            </div>
            <div class="summary-score">
                <div class="score-value">${avgRating.toFixed(1)}</div>
                <div class="stars">${getStarsHTML(avgRating)}</div>
                <span>Basado en ${total} reseñas</span>
            </div>`;
        viewProfesorDetail.querySelector('.btn-back').addEventListener('click', goBack);

        const reviewsSnapshot = await db.collection('resenas').where('profesorId', '==', profesor.id).orderBy('timestamp', 'desc').get();
        
        const todasLasResenas = reviewsSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(r => !esMateriaSpam(r.materia)); 

        const materiasLimpias = (profesor.materias || []).filter(m => !esMateriaSpam(m));

        renderizarFiltrosYResenas(todasLasResenas, materiasLimpias);
    };

    const abrirDetalleMateria = async (nombreMateria) => {
        mostrarVista(viewMateriaDetail);
        viewMateriaDetail.querySelector('.page-header').innerHTML = `<h1>Profesores de ${nombreMateria}</h1>`;
        viewMateriaDetail.querySelector('.btn-back').addEventListener('click', goBack);

        const profesQueLaImparten = profesoresDataCache.filter(p => p.materias?.includes(nombreMateria));
        const listaDiv = viewMateriaDetail.querySelector('#materia-profesores-list');
        listaDiv.innerHTML = '';
        
        if (profesQueLaImparten.length === 0) {
            listaDiv.innerHTML = '<p>No se encontraron profesores para esta materia.</p>';
            return;
        }
        
        profesQueLaImparten.forEach(profesor => {
            const avgRating = profesor.totalReseñas > 0 ? (profesor.sumaCalificaciones / profesor.totalReseñas) : 0;
            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `
                <h4>${profesor.apellido}, ${profesor.nombre}</h4>
                <div class="stars">${getStarsHTML(avgRating)} (${profesor.totalReseñas || 0})</div>`;
            item.addEventListener('click', () => abrirDetalleProfesor(profesor));
            listaDiv.appendChild(item);
        });
    };

    const renderizarFiltrosYResenas = (resenas, materias) => {
        const tagsContainer = viewProfesorDetail.querySelector('.materia-tags-container');
        tagsContainer.innerHTML = '';

        const btnTodos = document.createElement('button');
        btnTodos.className = 'tag-btn active';
        btnTodos.textContent = 'Todas las Materias';
        btnTodos.addEventListener('click', (e) => {
            tagsContainer.querySelectorAll('.tag-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            renderizarListaResenas(resenas);
        });
        tagsContainer.appendChild(btnTodos);

        materias.forEach(materia => {
            const btnMateria = document.createElement('button');
            btnMateria.className = 'tag-btn';
            btnMateria.textContent = materia;
            btnMateria.addEventListener('click', (e) => {
                tagsContainer.querySelectorAll('.tag-btn').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                const resenasFiltradas = resenas.filter(r => r.materia === materia);
                renderizarListaResenas(resenasFiltradas);
            });
            tagsContainer.appendChild(btnMateria);
        });

        renderizarListaResenas(resenas);
    };

    const renderizarListaResenas = (resenas) => {
        const reviewsList = viewProfesorDetail.querySelector('.detail-reviews-list');
        reviewsList.innerHTML = '';
        if (resenas.length === 0) {
            reviewsList.innerHTML = '<p>No hay reseñas que coincidan con este filtro.</p>';
            return;
        }
        resenas.forEach(reseña => {
            reviewsList.appendChild(createReviewCard(reseña.id, reseña));
        });
    };

    // --- FORMULARIO NUEVA RESEÑA ---
    formAddReview.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!auth.currentUser) {
            alert("Conectando con el servidor seguro...");
            return;
        }

        const nombre = inputNombre.value.trim();
        const apellido = inputApellido.value.trim();
        const materia = inputMateria.value.trim();
        const carrera = inputCarrera.value.trim();
        const texto = document.getElementById('add-texto-review').value.trim();

        if (currentRatings.general === 0) {
            alert('Por favor, selecciona una calificación general.');
            return;
        }
        if (carrera === "") {
            alert('Selecciona tu carrera.');
            return;
        }

        // VALIDACIÓN FRONTEND ANTI-SPAM
        if (esSpamProfesor({nombre, apellido})) {
             alert("Error: Nombre inválido detectado.");
             return;
        }
        if (esMateriaSpam(materia)) {
            alert("Error: Materia inválida.");
            return;
        }

        const profesorId = normalizarTexto(apellido + nombre);
        const profesorRef = db.collection('profesores').doc(profesorId);
        
        try {
            await db.runTransaction(async (transaction) => {
                const profDoc = await transaction.get(profesorRef);
                
                // BACKEND: Evitar crear profesores nuevos
                if (!profDoc.exists) {
                    throw "PROFESOR_NO_EXISTE";
                }

                const updateData = {
                    materias: firebase.firestore.FieldValue.arrayUnion(materia),
                    carreras: firebase.firestore.FieldValue.arrayUnion(carrera),
                    totalReseñas: firebase.firestore.FieldValue.increment(1),
                    sumaCalificaciones: firebase.firestore.FieldValue.increment(currentRatings.general),
                    sumaClaridad: firebase.firestore.FieldValue.increment(currentRatings.claridad),
                    sumaDificultad: firebase.firestore.FieldValue.increment(currentRatings.dificultad),
                    sumaCarga: firebase.firestore.FieldValue.increment(currentRatings.carga)
                };

                transaction.update(profesorRef, updateData);

                const reseñaRef = db.collection('resenas').doc();
                transaction.set(reseñaRef, {
                    profesorId, materia, calificacion: currentRatings.general, texto,
                    userId: auth.currentUser.uid, 
                    calificacionesDetalladas: {
                        claridad: currentRatings.claridad,
                        dificultad: currentRatings.dificultad,
                        carga: currentRatings.carga
                    },
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    likes: 0, dislikes: 0
                });
            });

            alert('¡Gracias! Tu reseña ha sido publicada.');
            formAddReview.reset();
            resetStarsUI();
        } catch (error) {
            console.error("Error al publicar: ", error);
            
            if (error === "PROFESOR_NO_EXISTE") {
                alert("⛔ Error: No se puede agregar un profesor nuevo. Solo se permiten reseñas a profesores existentes.");
            } 
            else if (error.code === 'resource-exhausted' || (error.message && error.message.includes('429'))) {
                alert("¡Límite diario alcanzado! Intenta mañana.");
            } else {
                alert("Hubo un problema. Intenta de nuevo.");
            }
        }
    });

    // --- AUTOCOMPLETADO Y UI HELPERS ---
    const showSuggestions = (element, suggestions, container) => {
        container.innerHTML = '';
        if (suggestions.length === 0) {
            container.style.display = 'none';
            return;
        }
        suggestions.slice(0, 5).forEach(suggestion => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.textContent = typeof suggestion === 'object' 
                ? `${suggestion.apellido}, ${suggestion.nombre}` 
                : suggestion;
            item.addEventListener('click', () => {
                if (typeof suggestion === 'object') {
                    inputNombre.value = suggestion.nombre;
                    inputApellido.value = suggestion.apellido;
                } else {
                    element.value = suggestion;
                }
                container.style.display = 'none';
            });
            container.appendChild(item);
        });
        container.style.display = 'block';
    };

    inputNombre.addEventListener('input', () => {
        const query = normalizarTexto(inputNombre.value);
        if (query.length < 2) { suggestionsNombre.style.display = 'none'; return; }
        const uniqueSuggestions = [...new Map(profesoresDataCache.filter(p => normalizarTexto(p.nombre).includes(query)).map(p => [p.id, p])).values()];
        showSuggestions(inputNombre, uniqueSuggestions, suggestionsNombre);
    });

    inputApellido.addEventListener('input', () => {
        const query = normalizarTexto(inputApellido.value);
        if (query.length < 2) { suggestionsApellido.style.display = 'none'; return; }
        const uniqueSuggestions = [...new Map(profesoresDataCache.filter(p => normalizarTexto(p.apellido).includes(query)).map(p => [p.id, p])).values()];
        showSuggestions(inputApellido, uniqueSuggestions, suggestionsApellido);
    });

    inputMateria.addEventListener('input', () => {
        const query = normalizarTexto(inputMateria.value);
        if (query.length < 3) { suggestionsMateria.style.display = 'none'; return; }
        const suggestions = [...materiasUnicasCache].filter(m => normalizarTexto(m).includes(query));
        showSuggestions(inputMateria, suggestions, suggestionsMateria);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.input-container')) {
            suggestionsNombre.style.display = 'none';
            suggestionsApellido.style.display = 'none';
            suggestionsMateria.style.display = 'none';
        }
    });

    const getStarsHTML = (rating) => {
        let html = '';
        const roundedRating = Math.round(rating * 2) / 2;
        for (let i = 1; i <= 5; i++) {
            if (i <= roundedRating) html += `<i class="fas fa-star"></i>`;
            else if (i - 0.5 === roundedRating) html += `<i class="fas fa-star-half-alt"></i>`;
            else html += `<i class="far fa-star"></i>`;
        }
        return html;
    };

    starRatingInputs.forEach(container => {
        const stars = [...container.querySelectorAll('.fa-star')];
        const ratingType = container.dataset.ratingType;
        const updateStarsVisual = (rating) => {
            stars.forEach(star => {
                const isSelected = star.dataset.value <= rating;
                star.classList.toggle('selected', isSelected);
                star.classList.toggle('fas', isSelected);
                star.classList.toggle('far', !isSelected);
            });
        };
        stars.forEach(star => {
            star.addEventListener('mouseover', () => updateStarsVisual(star.dataset.value));
            star.addEventListener('mouseout', () => updateStarsVisual(currentRatings[ratingType]));
            star.addEventListener('click', () => {
                currentRatings[ratingType] = parseInt(star.dataset.value);
                container.classList.add('selected');
                updateStarsVisual(currentRatings[ratingType]);
            });
        });
    });

    const resetStarsUI = () => {
        currentRatings = { general: 0, claridad: 0, dificultad: 0, carga: 0 };
        starRatingInputs.forEach(container => {
            container.querySelectorAll('.fa-star').forEach(s => {
                s.classList.remove('selected');
                s.classList.add('far');
                s.classList.remove('fas');
            });
            container.classList.remove('selected');
        });
    };

    const createReviewCard = (id, reseña) => {
        const card = document.createElement('div');
        card.className = 'review-card';
        const fecha = reseña.timestamp?.toDate().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) || 'Fecha no disponible';
        let detailedRatingsHTML = '';
        if (reseña.calificacionesDetalladas) {
            detailedRatingsHTML = `
            <div class="review-detailed-ratings">
                <div><span class="label">Claridad:</span> <span class="stars">${getStarsHTML(reseña.calificacionesDetalladas.claridad || 0)}</span></div>
                <div><span class="label">Dificultad:</span> <span class="stars">${getStarsHTML(reseña.calificacionesDetalladas.dificultad || 0)}</span></div>
                <div><span class="label">Carga:</span> <span class="stars">${getStarsHTML(reseña.calificacionesDetalladas.carga || 0)}</span></div>
            </div>`;
        }
        card.innerHTML = `
            <div class="review-header">
                <h4>Reseña sobre <strong>${reseña.materia}</strong></h4>
                <div class="stars">${getStarsHTML(reseña.calificacion)}</div>
            </div>
            <p class="review-body">${reseña.texto}</p>
            ${detailedRatingsHTML}
            <div class="review-footer">
                <span class="review-date">${fecha}</span>
                <div class="review-actions">
                    <button data-action="like"><i class="fas fa-thumbs-up"></i> <span>${reseña.likes || 0}</span></button>
                    <button data-action="dislike"><i class="fas fa-thumbs-down"></i> <span>${reseña.dislikes || 0}</span></button>
                    <button data-action="reply"><i class="fas fa-reply"></i> Responder</button>
                </div>
            </div>
            <div class="replies-container"></div>`;

        const likeBtn = card.querySelector('[data-action="like"]');
        const dislikeBtn = card.querySelector('[data-action="dislike"]');
        const replyBtn = card.querySelector('[data-action="reply"]');
        const repliesContainer = card.querySelector('.replies-container');
        
        replyBtn.addEventListener('click', () => toggleReplyForm(card, id));
        
        db.collection('resenas').doc(id).collection('respuestas').orderBy('timestamp').onSnapshot(snapshot => {
            repliesContainer.innerHTML = '';
            snapshot.forEach(doc => {
                const reply = doc.data();
                const replyCard = document.createElement('div');
                replyCard.className = 'reply-card';
                replyCard.innerHTML = `<p class="reply-header"><strong>${reply.alias || 'Anónimo'}</strong>:</p><p>${reply.texto}</p>`;
                repliesContainer.appendChild(replyCard);
            });
        });

        const voted = localStorage.getItem(`voted_${id}`);
        if (voted) {
            likeBtn.disabled = true; dislikeBtn.disabled = true;
            if (voted === 'like') likeBtn.style.color = 'var(--color-accent)';
        } else {
            likeBtn.addEventListener('click', () => handleVote(id, 'likes', likeBtn, dislikeBtn));
            dislikeBtn.addEventListener('click', () => handleVote(id, 'dislikes', likeBtn, dislikeBtn));
        }
        return card;
    };

    const toggleReplyForm = (reviewCard, reviewId) => {
        let form = reviewCard.querySelector('.reply-form');
        if (!auth.currentUser) return alert("Conectando...");
        if (form) { form.remove(); } else {
            form = document.createElement('form');
            form.className = 'reply-form';
            form.innerHTML = `<textarea placeholder="Respuesta..." required></textarea><button type="submit" class="btn-primary">Enviar</button>`;
            reviewCard.appendChild(form);
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const texto = form.querySelector('textarea').value.trim();
                const alias = localStorage.getItem('chatAlias') || 'Anónimo';
                if (texto) {
                    db.collection('resenas').doc(reviewId).collection('respuestas').add({
                        texto, alias, userId: auth.currentUser.uid, timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    form.remove();
                }
            });
        }
    };

    const handleVote = (reviewId, voteType, likeBtn, dislikeBtn) => {
        if (!auth.currentUser) return;
        const votedKey = `voted_${reviewId}`;
        if (localStorage.getItem(votedKey)) return;
        localStorage.setItem(votedKey, voteType);
        likeBtn.disabled = true; dislikeBtn.disabled = true;
        const reviewRef = db.collection('resenas').doc(reviewId);
        db.runTransaction(async (transaction) => {
            const doc = await transaction.get(reviewRef);
            if (!doc.exists) return;
            const currentVotes = doc.data()[voteType] || 0;
            transaction.update(reviewRef, { [voteType]: currentVotes + 1 });
            const span = voteType === 'likes' ? likeBtn.querySelector('span') : dislikeBtn.querySelector('span');
            span.textContent = currentVotes + 1;
        });
    };
    
    mostrarVista(viewMain);
});