class PWAApp {
    constructor() {
        this.apiUrl = 'https://jsonplaceholder.typicode.com/todos';
        this.data = [];
        this.deferredPrompt = null;
        this.isOnline = navigator.onLine;
        
        this.init();
    }

    async init() {
        this.registerServiceWorker();
        this.setupEventListeners();
        this.setupInstallPrompt();
        this.updateConnectionStatus();
        this.checkStorage();
        
        await this.loadData();
        this.renderData();
        
        // Периодическая проверка обновлений
        setInterval(() => this.checkForUpdates(), 30000);
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .then(reg => {
                    console.log('Service Worker зарегистрирован', reg);
                    this.updateCacheStatus('Активен');
                })
                .catch(err => {
                    console.error('Ошибка регистрации Service Worker:', err);
                    this.updateCacheStatus('Ошибка');
                });
        }
    }

    setupEventListeners() {
        document.getElementById('refreshBtn').addEventListener('click', () => this.loadData());
        document.getElementById('retryBtn').addEventListener('click', () => this.loadData());
        document.getElementById('clearCacheBtn').addEventListener('click', () => this.clearCache());
        document.getElementById('searchInput').addEventListener('input', () => this.renderData());
        document.getElementById('filterSelect').addEventListener('change', () => this.renderData());
        document.getElementById('addForm').addEventListener('submit', (e) => this.addItem(e));
        
        window.addEventListener('online', () => this.handleConnectionChange(true));
        window.addEventListener('offline', () => this.handleConnectionChange(false));
    }

    setupInstallPrompt() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            document.getElementById('installBtn').style.display = 'block';
            
            document.getElementById('installBtn').addEventListener('click', () => {
                if (this.deferredPrompt) {
                    this.deferredPrompt.prompt();
                    this.deferredPrompt.userChoice.then((choiceResult) => {
                        if (choiceResult.outcome === 'accepted') {
                            console.log('Пользователь установил PWA');
                        }
                        this.deferredPrompt = null;
                        document.getElementById('installBtn').style.display = 'none';
                    });
                }
            });
        });
    }

    async loadData() {
        const loading = document.getElementById('loading');
        const error = document.getElementById('error');
        const offlineMessage = document.getElementById('offlineMessage');
        
        loading.classList.remove('hidden');
        error.classList.add('hidden');
        offlineMessage.classList.add('hidden');
        
        try {
            if (!this.isOnline) {
                throw new Error('Нет подключения к интернету');
            }
            
            const response = await fetch(this.apiUrl + '?_limit=10');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            this.data = await response.json();
            
            // Сохраняем в IndexedDB
            await this.saveToIndexedDB();
            
            // Кэшируем данные
            await this.cacheData();
            
            this.updateLastSync();
            this.renderData();
            
        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
            
            // Пытаемся загрузить из IndexedDB
            await this.loadFromIndexedDB();
            
            if (this.data.length === 0) {
                error.classList.remove('hidden');
            } else {
                offlineMessage.classList.remove('hidden');
            }
        } finally {
            loading.classList.add('hidden');
        }
    }

    async saveToIndexedDB() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                return resolve();
            }
            
            const request = indexedDB.open('PWA_DB', 1);
            
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('data')) {
                    db.createObjectStore('data', { keyPath: 'id' });
                }
            };
            
            request.onsuccess = (e) => {
                const db = e.target.result;
                const transaction = db.transaction(['data'], 'readwrite');
                const store = transaction.objectStore('data');
                
                // Очищаем старые данные
                store.clear();
                
                // Сохраняем новые данные
                this.data.forEach(item => {
                    store.put(item);
                });
                
                transaction.oncomplete = () => {
                    console.log('Данные сохранены в IndexedDB');
                    this.updateDBStatus('Данные сохранены');
                    resolve();
                };
                
                transaction.onerror = () => {
                    console.error('Ошибка сохранения в IndexedDB');
                    reject();
                };
            };
            
            request.onerror = () => {
                console.error('Ошибка открытия IndexedDB');
                reject();
            };
        });
    }

    async loadFromIndexedDB() {
        return new Promise((resolve) => {
            if (!window.indexedDB) {
                return resolve();
            }
            
            const request = indexedDB.open('PWA_DB', 1);
            
            request.onsuccess = (e) => {
                const db = e.target.result;
                const transaction = db.transaction(['data'], 'readonly');
                const store = transaction.objectStore('data');
                const getAllRequest = store.getAll();
                
                getAllRequest.onsuccess = () => {
                    this.data = getAllRequest.result;
                    console.log('Данные загружены из IndexedDB:', this.data.length);
                    this.updateDBStatus('Кэшированные данные');
                    this.renderData();
                    resolve();
                };
                
                getAllRequest.onerror = () => {
                    console.error('Ошибка загрузки из IndexedDB');
                    resolve();
                };
            };
            
            request.onerror = () => {
                console.error('Ошибка открытия IndexedDB');
                resolve();
            };
        });
    }

    async cacheData() {
        if ('caches' in window) {
            try {
                const cache = await caches.open('pwa-data');
                await cache.put(this.apiUrl + '?_limit=10', new Response(JSON.stringify(this.data)));
                console.log('Данные закэшированы');
            } catch (error) {
                console.error('Ошибка кэширования:', error);
            }
        }
    }

    async clearCache() {
        if ('caches' in window) {
            try {
                await caches.delete('pwa-data');
                if (window.indexedDB) {
                    const db = await indexedDB.deleteDatabase('PWA_DB');
                }
                this.data = [];
                this.renderData();
                this.updateCacheStatus('Очищен');
                this.updateDBStatus('Очищен');
                alert('Кэш очищен!');
            } catch (error) {
                console.error('Ошибка очистки кэша:', error);
            }
        }
    }

    renderData() {
        const container = document.getElementById('dataContainer');
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        const filter = document.getElementById('filterSelect').value;
        
        if (!this.data || this.data.length === 0) {
            container.innerHTML = '<p class="no-data">Нет данных для отображения</p>';
            return;
        }
        
        const filteredData = this.data.filter(item => {
            const matchesSearch = item.title.toLowerCase().includes(searchTerm);
            const matchesFilter = filter === 'all' || 
                (filter === 'completed' && item.completed) ||
                (filter === 'pending' && !item.completed);
            return matchesSearch && matchesFilter;
        });
        
        if (filteredData.length === 0) {
            container.innerHTML = '<p class="no-data">Нет данных, соответствующих фильтрам</p>';
            return;
        }
        
        container.innerHTML = filteredData.map(item => `
            <div class="data-card ${item.completed ? 'completed' : ''}">
                <h3>${this.escapeHtml(item.title)}</h3>
                <p>${item.completed ? '✅ Завершено' : '⏳ В процессе'}</p>
                <div class="meta">
                    <span>ID: ${item.id}</span>
                    <span>${item.userId ? `Пользователь: ${item.userId}` : ''}</span>
                </div>
            </div>
        `).join('');
    }

    async addItem(e) {
        e.preventDefault();
        
        const titleInput = document.getElementById('titleInput');
        const descriptionInput = document.getElementById('descriptionInput');
        const completedInput = document.getElementById('completedInput');
        
        if (!titleInput.value.trim()) {
            alert('Введите название');
            return;
        }
        
        const newItem = {
            id: Date.now(),
            title: titleInput.value,
            description: descriptionInput.value,
            completed: completedInput.checked,
            userId: 1,
            timestamp: new Date().toISOString()
        };
        
        // Добавляем локально
        this.data.unshift(newItem);
        this.renderData();
        
        // Очищаем форму
        titleInput.value = '';
        descriptionInput.value = '';
        completedInput.checked = false;
        
        // Пытаемся отправить на сервер
        if (this.isOnline) {
            try {
                const response = await fetch(this.apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(newItem)
                });
                
                if (response.ok) {
                    console.log('Данные отправлены на сервер');
                }
            } catch (error) {
                console.error('Ошибка отправки данных:', error);
            }
        }
        
        // Сохраняем в IndexedDB
        await this.saveToIndexedDB();
    }

    updateConnectionStatus() {
        const statusElement = document.getElementById('connectionStatus');
        this.isOnline = navigator.onLine;
        
        if (this.isOnline) {
            statusElement.textContent = '● Онлайн';
            statusElement.className = 'status-online';
        } else {
            statusElement.textContent = '● Оффлайн';
            statusElement.className = 'status-offline';
        }
    }

    handleConnectionChange(isOnline) {
        this.isOnline = isOnline;
        this.updateConnectionStatus();
        
        if (isOnline) {
            // При восстановлении соединения проверяем обновления
            this.checkForUpdates();
        }
    }

    updateLastSync() {
        const element = document.getElementById('lastSync');
        const now = new Date();
        element.textContent = `Обновлено: ${now.toLocaleTimeString()}`;
    }

    checkStorage() {
        if ('caches' in window) {
            this.updateCacheStatus('Доступен');
        } else {
            this.updateCacheStatus('Не поддерживается');
        }
        
        if (window.indexedDB) {
            this.updateDBStatus('Доступен');
        } else {
            this.updateDBStatus('Не поддерживается');
        }
    }

    updateCacheStatus(status) {
        document.getElementById('cacheStatus').textContent = status;
    }

    updateDBStatus(status) {
        document.getElementById('dbStatus').textContent = status;
    }

    async checkForUpdates() {
        if (!this.isOnline) return;
        
        try {
            const response = await fetch(this.apiUrl + '?_limit=10&_t=' + Date.now());
            if (response.ok) {
                const newData = await response.json();
                // Здесь можно сравнить данные и обновить если нужно
                console.log('Проверка обновлений выполнена');
            }
        } catch (error) {
            console.error('Ошибка проверки обновлений:', error);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new PWAApp();
});