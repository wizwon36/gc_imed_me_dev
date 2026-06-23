(function () {
  let orgDataCache = null;

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function getClinics() {
    return orgDataCache?.clinics || [];
  }

  function getTeams() {
    return orgDataCache?.teams || [];
  }

  function getTeamParentCode(team) {
    return normalizeText(team.parent_code || team.parentCode || team.clinic_code);
  }

  async function loadOrgData(forceReload = false) {
    if (orgDataCache && !forceReload) {
      return orgDataCache;
    }

    const result = await apiGet('getOrgData');
    const data = result?.data || {};

    orgDataCache = {
      clinics: Array.isArray(data.clinics) ? data.clinics : [],
      teams: Array.isArray(data.teams) ? data.teams : []
    };

    return orgDataCache;
  }

function fillSelectOptions(selectEl, items, config = {}) {
  if (!selectEl) return;

  const valueKey = config.valueKey || 'code_value';
  const labelKey = config.labelKey || 'code_name';
  const includeEmpty = config.includeEmpty !== false;
  const emptyText = config.emptyText || '선택하세요';
  const keepDisabled = config.keepDisabled === true;

  const currentValue = normalizeText(selectEl.value);
  selectEl.innerHTML = '';

  if (includeEmpty) {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = emptyText;
    selectEl.appendChild(emptyOption);
  }

  (items || []).forEach(item => {
    const option = document.createElement('option');
    option.value = normalizeText(item[valueKey]);
    option.textContent = normalizeText(item[labelKey]);
    selectEl.appendChild(option);
  });

  if (currentValue) {
    selectEl.value = currentValue;
  }

  if (!keepDisabled) {
    selectEl.disabled = false;
  }
}

  function getFilteredTeams(clinicCode) {
    const code = normalizeText(clinicCode);
    if (!code) return [];

    return getTeams().filter(team => getTeamParentCode(team) === code);
  }

  function bindClinicTeamSelects(options = {}) {
    const clinicSelect = typeof options.clinicSelect === 'string'
      ? document.querySelector(options.clinicSelect)
      : options.clinicSelect;

    const teamSelect = typeof options.teamSelect === 'string'
      ? document.querySelector(options.teamSelect)
      : options.teamSelect;

    const onTeamChanged = typeof options.onTeamChanged === 'function'
      ? options.onTeamChanged
      : null;

    if (!clinicSelect || !teamSelect) {
      return;
    }

    function renderTeamsByClinic(clinicCode, preferredTeamCode = '') {
      const normalizedClinicCode = normalizeText(clinicCode);
      const teams = getFilteredTeams(normalizedClinicCode);
      const emptyText = options.teamEmptyText || '팀을 선택하세요';

      fillSelectOptions(teamSelect, teams, {
        emptyText: emptyText,
        keepDisabled: !normalizedClinicCode
      });
    
      teamSelect.disabled = !normalizedClinicCode;
    
      if (preferredTeamCode) {
        teamSelect.value = normalizeText(preferredTeamCode);
      } else {
        teamSelect.value = '';
      }
    
      if (onTeamChanged) {
        onTeamChanged({
          clinic_code: normalizeText(clinicSelect.value),
          team_code: normalizeText(teamSelect.value)
        });
      }
    }

    clinicSelect.addEventListener('change', () => {
      renderTeamsByClinic(clinicSelect.value, '');

      if (onTeamChanged) {
        onTeamChanged({
          clinic_code: normalizeText(clinicSelect.value),
          team_code: normalizeText(teamSelect.value)
        });
      }
    });

    teamSelect.addEventListener('change', () => {
      if (onTeamChanged) {
        onTeamChanged({
          clinic_code: normalizeText(clinicSelect.value),
          team_code: normalizeText(teamSelect.value)
        });
      }
    });

    return {
      renderTeamsByClinic
    };
  }

  function getClinicByCode(clinicCode) {
    const code = normalizeText(clinicCode);
    return getClinics().find(item => normalizeText(item.code_value) === code) || null;
  }

  function getTeamByCode(teamCode) {
    const code = normalizeText(teamCode);
    return getTeams().find(item => normalizeText(item.code_value) === code) || null;
  }

  function getOrgDisplayText(clinicCode, teamCode) {
    const clinic = getClinicByCode(clinicCode);
    const team = getTeamByCode(teamCode);

    const clinicName = normalizeText(clinic?.code_name);
    const teamName = normalizeText(team?.code_name);

    if (clinicName && teamName) return `${clinicName} / ${teamName}`;
    if (teamName) return teamName;
    if (clinicName) return clinicName;
    return '';
  }

  window.orgSelect = {
    loadOrgData,
    getClinics,
    getTeams,
    getClinicByCode,
    getTeamByCode,
    getFilteredTeams,
    getOrgDisplayText,
    fillSelectOptions,
    bindClinicTeamSelects,
    clearCache() {
      orgDataCache = null;
    }
  };
})();
