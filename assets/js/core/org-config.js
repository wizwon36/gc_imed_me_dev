window.ORG_CONFIG = {
  get CACHE_KEY() {
    return (typeof CONFIG !== 'undefined' && CONFIG.CACHE_KEYS)
      ? CONFIG.CACHE_KEYS.ORG_DATA
      : 'gc_imed_me_org_data_v1';
  },
  CACHE_TTL: 1000 * 60 * 30,
  cache: {
    loaded: false,
    loadingPromise: null,
    clinics: [],
    teams: []
  }
};

window.OrgService = {
  normalize(value) {
    return String(value || '').trim();
  },

  getCachedData() {
    try {
      const raw = sessionStorage.getItem(window.ORG_CONFIG.CACHE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.savedAt || !parsed.data) return null;

      const isExpired = (Date.now() - parsed.savedAt) > window.ORG_CONFIG.CACHE_TTL;
      if (isExpired) return null;

      return parsed.data;
    } catch (error) {
      return null;
    }
  },

  setCachedData(data) {
    try {
      sessionStorage.setItem(
        window.ORG_CONFIG.CACHE_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          data
        })
      );
    } catch (error) {
      // ignore
    }
  },

  async load() {
    if (window.ORG_CONFIG.cache.loaded) {
      return window.ORG_CONFIG.cache;
    }

    const cached = this.getCachedData();
    if (cached) {
      window.ORG_CONFIG.cache.loaded = true;
      window.ORG_CONFIG.cache.clinics = Array.isArray(cached.clinics) ? cached.clinics : [];
      window.ORG_CONFIG.cache.teams = Array.isArray(cached.teams) ? cached.teams : [];
      return window.ORG_CONFIG.cache;
    }

    if (window.ORG_CONFIG.cache.loadingPromise) {
      return window.ORG_CONFIG.cache.loadingPromise;
    }

    window.ORG_CONFIG.cache.loadingPromise = (async () => {
      const result = await apiGet('getOrgData');
      const data = result.data || {};

      const clinics = Array.isArray(data.clinics) ? data.clinics : [];
      const teams = Array.isArray(data.teams) ? data.teams : [];

      window.ORG_CONFIG.cache.loaded = true;
      window.ORG_CONFIG.cache.clinics = clinics;
      window.ORG_CONFIG.cache.teams = teams;

      this.setCachedData({ clinics, teams });

      return window.ORG_CONFIG.cache;
    })();

    try {
      return await window.ORG_CONFIG.cache.loadingPromise;
    } finally {
      window.ORG_CONFIG.cache.loadingPromise = null;
    }
  },

  async preload() {
    await this.load();
  },

  async getClinics() {
    const cache = await this.load();
    return cache.clinics;
  },

  async getTeams() {
    const cache = await this.load();
    return cache.teams;
  },

  getClinicCodeValue(item) {
    return this.normalize(item?.code_value || item?.code || item?.value);
  },

  getClinicNameValue(item) {
    return this.normalize(item?.code_name || item?.name);
  },

  getTeamCodeValue(item) {
    return this.normalize(item?.code_value || item?.code || item?.value);
  },

  getTeamNameValue(item) {
    return this.normalize(item?.code_name || item?.name);
  },

  getTeamParentClinicCode(item) {
    return this.normalize(
      item?.parent_code ||
      item?.parent_code_value ||
      item?.clinic_code ||
      item?.parentClinicCode
    );
  },

  async getTeamsByClinicCode(clinicCode) {
    const teams = await this.getTeams();
    const target = this.normalize(clinicCode);
    if (!target) return [];

    return teams.filter((team) => this.getTeamParentClinicCode(team) === target);
  },

  async getClinicName(clinicCode) {
    const clinics = await this.getClinics();
    const target = this.normalize(clinicCode);

    const found = clinics.find(item => this.getClinicCodeValue(item) === target);
    return found ? this.getClinicNameValue(found) : '';
  },

  async getTeamName(teamCode) {
    const teams = await this.getTeams();
    const target = this.normalize(teamCode);

    const found = teams.find(item => this.getTeamCodeValue(item) === target);
    return found ? this.getTeamNameValue(found) : '';
  },

  buildDepartmentText(clinicName, teamName) {
    const clinic = this.normalize(clinicName);
    const team = this.normalize(teamName);
    if (clinic && team) return `${clinic} / ${team}`;
    return '';
  },

  setLoadingState(clinicEl, teamEl) {
    if (clinicEl) {
      clinicEl.innerHTML = '<option value="">의원 불러오는 중...</option>';
      clinicEl.disabled = true;
    }

    if (teamEl) {
      teamEl.innerHTML = '<option value="">팀 불러오는 중...</option>';
      teamEl.disabled = true;
    }
  },

  async fillClinicSelect(selectEl, options = {}) {
    if (!selectEl) return;

    const {
      includeEmpty = true,
      emptyLabel = '의원을 선택하세요',
      selectedValue = ''
    } = options;

    const clinics = await this.getClinics();

    let html = '';
    if (includeEmpty) {
      html += `<option value="">${emptyLabel}</option>`;
    }

    html += clinics.map(item => {
      const value = this.getClinicCodeValue(item);
      const name = this.getClinicNameValue(item);
      return `<option value="${value}">${name}</option>`;
    }).join('');

    selectEl.innerHTML = html;
    selectEl.disabled = false;
    selectEl.value = selectedValue || '';
  },

  async fillTeamSelect(selectEl, clinicCode, options = {}) {
    if (!selectEl) return;

    const {
      includeEmpty = true,
      emptyLabel = '팀을 선택하세요',
      selectedValue = ''
    } = options;

    const teams = clinicCode ? await this.getTeamsByClinicCode(clinicCode) : [];

    let html = '';
    if (includeEmpty) {
      html += `<option value="">${emptyLabel}</option>`;
    }

    html += teams.map(item => {
      const value = this.getTeamCodeValue(item);
      const name = this.getTeamNameValue(item);
      return `<option value="${value}">${name}</option>`;
    }).join('');

    selectEl.innerHTML = html;
    selectEl.disabled = !clinicCode;
    selectEl.value = selectedValue || '';
  },

  async updateDepartmentField(clinicCode, teamCode, departmentEl) {
    if (!departmentEl) return '';

    const clinicName = await this.getClinicName(clinicCode);
    const teamName = await this.getTeamName(teamCode);
    const department = this.buildDepartmentText(clinicName, teamName);

    departmentEl.value = department || '';
    return department;
  },

  async bindClinicTeam(clinicEl, teamEl, options = {}) {
    if (!clinicEl || !teamEl) return;

    const {
      clinicEmptyLabel = '의원을 선택하세요',
      teamEmptyLabel = '팀을 선택하세요',
      initialClinicCode = '',
      initialTeamCode = '',
      departmentEl = null
    } = options;

    this.setLoadingState(clinicEl, teamEl);

    await this.fillClinicSelect(clinicEl, {
      includeEmpty: true,
      emptyLabel: clinicEmptyLabel,
      selectedValue: initialClinicCode
    });

    await this.fillTeamSelect(teamEl, initialClinicCode, {
      includeEmpty: true,
      emptyLabel: teamEmptyLabel,
      selectedValue: initialTeamCode
    });

    await this.updateDepartmentField(initialClinicCode, initialTeamCode, departmentEl);

    if (clinicEl.dataset.orgBound !== 'Y') {
      clinicEl.addEventListener('change', async () => {
        await this.fillTeamSelect(teamEl, clinicEl.value, {
          includeEmpty: true,
          emptyLabel: teamEmptyLabel,
          selectedValue: ''
        });
        await this.updateDepartmentField(clinicEl.value, '', departmentEl);
      });
      clinicEl.dataset.orgBound = 'Y';
    }

    if (teamEl.dataset.orgBound !== 'Y') {
      teamEl.addEventListener('change', async () => {
        await this.updateDepartmentField(clinicEl.value, teamEl.value, departmentEl);
      });
      teamEl.dataset.orgBound = 'Y';
    }
  },

  async buildOrgPayload(clinicCode, teamCode) {
    const clinic_name = await this.getClinicName(clinicCode);
    const team_name = await this.getTeamName(teamCode);

    return {
      clinic_code: clinicCode || '',
      clinic_name: clinic_name || '',
      team_code: teamCode || '',
      team_name: team_name || '',
      department: this.buildDepartmentText(clinic_name, team_name)
    };
  },

  clearCache() {
    window.ORG_CONFIG.cache.loaded = false;
    window.ORG_CONFIG.cache.clinics = [];
    window.ORG_CONFIG.cache.teams = [];
    window.ORG_CONFIG.cache.loadingPromise = null;
    try {
      sessionStorage.removeItem(window.ORG_CONFIG.CACHE_KEY);
    } catch (e) {}
  }
};
