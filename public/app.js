/**
 * 미담사진관 태블릿 웹 - 메인 로직 (프로덕션)
 *
 * v1.4.0 (2026.04.20 고객 피드백 3차):
 * - 전화번호 입력 기본값 "010-" 복원
 * - 전화번호 검증 엄격화: 정확히 4 / 7 / 8 / 11 자리만 허용 (그 외 거부)
 * - 7자리 하이픈 포맷 추가 (010-1234)
 * - 실시간 포매팅에서 "010-" 프리필 보호
 * - 에러 메시지 맵 보강
 *
 * v1.3.0 (2026.04.20 고객 피드백 2차):
 * - 전화번호 검증 완화: 11자리 010 강제 -> 4자리 이상 허용
 * - 길이별 자동 하이픈 포맷 (4자리 그대로 / 8자리 0000-0000 / 11자리 010-0000-0000)
 * - 입력 중 실시간 포맷팅 적용
 */

(function () {
  'use strict'

  // ============================================================
  // 상태
  // ============================================================
  const state = {
    waitlist: [],
    authTarget: null,      // { id, name } - 현재 인증 중인 대기자
    verifiedLast4: null,   // 인증 성공한 끝4자리
    isSubmitting: false,
    pendingCreate: null,   // { key, requestId } - 같은 입력 재전송 시 동일 requestId 재사용
    isLoading: false,
    listOkAt: 0            // 대기목록을 마지막으로 불러온 시각 (ms)
  }

  // 대기목록 새로고침이 실패해도 이 시간 안에 불러온 목록이 있으면 오류 대신 그 목록을 그대로 둔다
  const LIST_STALE_MS = 120000

  // ============================================================
  // DOM 참조
  // ============================================================
  const $ = (id) => document.getElementById(id)

  const els = {
    inputName: $('input-name'),
    inputPhone: $('input-phone'),
    inputEmail: $('input-email'),
    btnSubmit: $('btn-submit'),
    btnCancel: $('btn-cancel'),
    btnRefresh: $('btn-refresh'),
    waitlistContainer: $('waitlist-container'),

    modalAuth: $('modal-auth'),
    authTargetName: $('auth-target-name'),
    inputLast4: $('input-last4'),
    authError: $('auth-error'),
    btnAuthConfirm: $('btn-auth-confirm'),
    btnAuthCancel: $('btn-auth-cancel'),

    modalEdit: $('modal-edit'),
    editName: $('edit-name'),
    editPhone: $('edit-phone'),
    editEmail: $('edit-email'),
    btnEditSave: $('btn-edit-save'),
    btnEditCancel: $('btn-edit-cancel'),

    modalMessage: $('modal-message'),
    modalMessageText: $('modal-message-text'),
    btnMessageOk: $('btn-message-ok'),

    toastContainer: $('toast-container')
  }

  // ============================================================
  // 유틸
  // ============================================================

  function sanitizeInput(str) {
    if (str === null || str === undefined) return ''
    return String(str).trim().replace(/[\x00-\x1F\x7F]/g, '').slice(0, 200)
  }

  function extractDigits(str) {
    return String(str || '').replace(/\D/g, '')
  }

  // 허용 자릿수 (숫자만 추출 후 판단)
  // - 4자리:  끝번호만 ("1234")
  // - 7자리:  010 + 끝번호 4자리 ("0101234")
  // - 8자리:  중간+끝 ("12345678")
  // - 11자리: 010 + 전체 ("01012345678")
  const ALLOWED_PHONE_LENGTHS = [4, 7, 8, 11]

  // 전화번호 검증 - 4/7/8/11 자리만 허용
  //function isValidPhoneStrict(phone) {
 //   const digits = extractDigits(phone)
 //   if (!ALLOWED_PHONE_LENGTHS.includes(digits.length)) return false
    // 7자리 / 11자리는 반드시 010으로 시작
 //   if ((digits.length === 7 || digits.length === 11) && !digits.startsWith('010')) return false
 //   return true
//  }

 /* 84번 줄부터 수정 시작 */
// 전화번호 검증 - 오직 010으로 시작하는 7자리 또는 11자리만 허용
function isValidPhoneStrict(phone) {
    const digits = extractDigits(phone);
    const ALLOWED_PHONE_LENGTHS = [7, 11]; 

    // 1. 자릿수 체크 (7자 또는 11자 아님 탈락)
    if (!ALLOWED_PHONE_LENGTHS.includes(digits.length)) {
        return false;
    }

    // 2. 무조건 '010'으로 시작하는지 체크
    if (!digits.startsWith('010')) {
        return false;
    }

    return true;
}

  /**
   * 길이별 하이픈 자동 포맷
   * - 4자리:  "5678"        -> "5678"
   * - 7자리:  "0101234"     -> "010-1234"
   * - 8자리:  "12345678"    -> "1234-5678"
   * - 11자리: "01012345678" -> "010-1234-5678"
   * - 그 외:  숫자만 유지 (하이픈 없음)
   *
   * 입력 중 실시간 포매팅용 - 최대 11자리까지만 허용
   */
  function formatPhoneByLength(raw) {
    const digits = extractDigits(raw).slice(0, 11)   // 11자리 초과 자동 절삭
    const len = digits.length

    if (len === 11) {
      return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7, 11)
    }
    if (len === 8) {
      return digits.slice(0, 4) + '-' + digits.slice(4, 8)
    }
    if (len === 7) {
      return digits.slice(0, 3) + '-' + digits.slice(3, 7)
    }
    // 4자리 / 기타 길이는 하이픈 없이 숫자만
    return digits
  }

  function isValidEmail(email) {
    if (!email) return true   // 선택 입력
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }

  // ============================================================
  // 메시지 모달 (재진입 안전)
  // ============================================================

  let messageResolve = null
  function showMessage(message) {
    return new Promise((resolve) => {
      els.modalMessageText.textContent = message
      els.modalMessage.hidden = false
      messageResolve = resolve
    })
  }

  // ============================================================
  // 토스트
  // ============================================================

  function showToast(message, type = 'default') {
    const toast = document.createElement('div')
    toast.className = 'toast' + (type !== 'default' ? ' toast--' + type : '')
    toast.textContent = message
    els.toastContainer.appendChild(toast)
    setTimeout(() => toast.remove(), 2600)
  }

  // ============================================================
  // API 호출
  // ============================================================

  function newRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID()
    }
    return 'r' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
  }

  // 같은 요청을 다시 보내도 결과가 같은 작업은 일시 오류 시 1회 자동 재시도
  // (구글 Apps Script가 간헐적으로 처리 후 404 페이지를 돌려주는 경우 대응)
  const IDEMPOTENT_ACTIONS = ['list', 'verify', 'update', 'ping']

  // 서버가 요청을 받았지만 시트 쪽 지연·잠금 대기로 처리하지 못한 경우 -> 다시 보내면 대부분 처리됨
  // UNAUTHORIZED: 요청 내용이 비어서 도착하는 일시 현상 대응 (토큰이 틀리면 재시도도 같은 결과)
  const RETRYABLE_SERVER_ERRORS = ['BUSY', 'CREATE_FAILED', 'UPDATE_FAILED', 'SERVER_ERROR', 'UNAUTHORIZED']

  function serverError(result, fallback) {
    const err = new Error((result && result.error) || fallback)
    err.detail = result && result.message ? String(result.message) : ''
    return err
  }

  function errorText(err) {
    const text = translateError(err && err.message)
    const detail = String((err && err.detail) || '').replace(/\s+/g, ' ').trim()
    return detail ? text + '\n(' + detail.slice(0, 60) + ')' : text
  }

  function isTransientError(err) {
    const msg = String(err && err.message || '')
    return msg === 'TIMEOUT' || msg.startsWith('HTTP_') || msg === 'Failed to fetch' ||
      (err && err.name === 'SyntaxError')
  }

  // 구글 웹앱은 가끔 요청 하나가 30초 넘게 멈추거나 404로 끝나고, 바로 다시 보낸 요청은 대부분 정상 처리된다
  // 그래서 한 번에 오래 기다리기보다 짧게 끊고 최대 3번까지 보낸다
  const MAX_ATTEMPTS = 3

  // retry: 같은 요청을 다시 보내도 결과가 같은 경우만 true (등록은 requestId로 서버가 중복을 막아 true로 호출)
  // 오류 기록 서버로 신호만 보낸다 (손님 이름·번호·이메일은 보내지 않음, 실패해도 화면 동작에 영향 없음)
  function reportEvent(kind, action, info) {
    const c = window.APP_CONFIG || {}
    if (!c.LOG_URL || !c.LOG_KEY) return
    try {
      const body = JSON.stringify({
        key: c.LOG_KEY,
        store: c.SHOP_NAME || '',
        kind: kind,
        action: action,
        error: String(info.error || ''),
        attempts: info.attempts || 0,
        ms: info.ms || 0,
        detail: String(info.detail || '').slice(0, 100),
        ua: String(navigator.userAgent || '').slice(0, 120)
      })
      const blob = new Blob([body], { type: 'text/plain;charset=utf-8' })
      if (navigator.sendBeacon && navigator.sendBeacon(c.LOG_URL, blob)) return
      fetch(c.LOG_URL, { method: 'POST', mode: 'no-cors', keepalive: true, body: blob }).catch(() => {})
    } catch (e) {}
  }

  // silent: 호출한 쪽이 결과를 직접 기록할 때 (수정 저장 확인 흐름)
  async function apiCall(action, data = {}, opts = {}) {
    const canRetry = opts.retry !== undefined ? opts.retry : IDEMPOTENT_ACTIONS.indexOf(action) !== -1
    const maxAttempts = canRetry ? MAX_ATTEMPTS : 1
    const started = Date.now()
    const report = (kind, info) => { if (!opts.silent) reportEvent(kind, action, Object.assign({ ms: Date.now() - started }, info)) }
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await apiCallOnce(action, data)
        const retryable = result && result.ok === false && RETRYABLE_SERVER_ERRORS.indexOf(result.error) !== -1
        // 서버가 받았지만 처리하지 못한 응답도 다시 보낸다
        if (attempt < maxAttempts && retryable) {
          await new Promise((r) => setTimeout(r, 1500))
          continue
        }
        if (retryable) report('failed', { error: result.error, attempts: attempt, detail: result.message })
        else if (attempt > 1 && result && result.ok) report('recovered', { attempts: attempt })
        return result
      } catch (err) {
        if (attempt >= maxAttempts || !isTransientError(err)) {
          if (isTransientError(err)) report('failed', { error: err.message, attempts: attempt })
          throw err
        }
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
  }

  async function apiCallOnce(action, data = {}) {
    const config = window.APP_CONFIG

    if (!config || !config.APPS_SCRIPT_URL || config.APPS_SCRIPT_URL.includes('YOUR_DEPLOYMENT_ID')) {
      throw new Error('CONFIG_NOT_SET')
    }

    const body = {
      action: action,
      token: config.API_TOKEN,
      ...data
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.REQUEST_TIMEOUT_MS || 15000)

    try {
      const response = await fetch(config.APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-cache',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'follow'
      })

      clearTimeout(timeout)
      if (!response.ok) throw new Error('HTTP_' + response.status)

      const json = await response.json()
      return json
    } catch (err) {
      clearTimeout(timeout)
      if (err.name === 'AbortError') throw new Error('TIMEOUT')
      throw err
    }
  }

  // ============================================================
  // 대기리스트
  // ============================================================

  async function loadWaitlist() {
    if (state.isLoading) return
    state.isLoading = true
    els.btnRefresh.classList.add('is-spinning')

    try {
      const result = await apiCall('list')
      if (!result.ok) throw new Error(result.error || 'LOAD_FAILED')
      state.waitlist = result.list || []
      state.listOkAt = Date.now()
      renderWaitlist()
    } catch (err) {
      console.error('loadWaitlist error:', err)
      if (state.listOkAt && Date.now() - state.listOkAt < LIST_STALE_MS) return
      renderWaitlistError(err.message)
    } finally {
      state.isLoading = false
      setTimeout(() => els.btnRefresh.classList.remove('is-spinning'), 300)
    }
  }

  function renderWaitlist() {
    const container = els.waitlistContainer
    container.innerHTML = ''

    if (state.waitlist.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'waitlist-empty'
      empty.textContent = '대기 중인 손님이 없습니다'
      container.appendChild(empty)
      return
    }

    const frag = document.createDocumentFragment()
    state.waitlist.forEach((item) => {
      const div = document.createElement('div')
      div.className = 'waitlist-item'
      div.dataset.id = item.id
      div.dataset.name = item.name
      div.textContent = item.name
      div.addEventListener('click', () => openAuthModal(item))
      frag.appendChild(div)
    })
    container.appendChild(frag)
  }

  function renderWaitlistError(msg) {
    const container = els.waitlistContainer
    container.innerHTML = ''
    const div = document.createElement('div')
    div.className = 'waitlist-error'
    div.textContent = '불러오기 실패 (' + translateError(msg) + ')'
    container.appendChild(div)
  }

  // ============================================================
  // 등록
  // ============================================================

  async function handleSubmit() {
    if (state.isSubmitting) return

    const name = sanitizeInput(els.inputName.value)
    const phone = sanitizeInput(els.inputPhone.value)
    const email = sanitizeInput(els.inputEmail.value)

    if (!name) { await showMessage('이름을 입력해주세요'); els.inputName.focus(); return }
    if (!phone) { await showMessage('전화번호를 입력해주세요'); els.inputPhone.focus(); return }
    if (!isValidPhoneStrict(phone)) {
      await showMessage('전화번호 8자리 또는 끝번호 4자리를 입력해주세요')
      els.inputPhone.focus()
      return
    }
    if (email && !isValidEmail(email)) { await showMessage('이메일 형식이 올바르지 않습니다'); els.inputEmail.focus(); return }

    state.isSubmitting = true
    els.btnSubmit.disabled = true
    els.btnSubmit.textContent = '등록 중...'

    try {
      const key = [name, phone, email].join('|')
      if (!state.pendingCreate || state.pendingCreate.key !== key) {
        state.pendingCreate = { key: key, requestId: newRequestId() }
      }
      const payload = { data: { name, phone, email }, requestId: state.pendingCreate.requestId }

      // 같은 requestId로 최대 3번 -> 서버가 같은 손님을 두 번 넣지 않음
      const result = await apiCall('create', payload, { retry: true })
      if (!result.ok) throw serverError(result, 'CREATE_FAILED')
      state.pendingCreate = null
      showToast('등록 완료', 'success')
      resetForm()
      await loadWaitlist()
    } catch (err) {
      console.error('submit error:', err)
      await showMessage('등록 실패\n' + errorText(err))
    } finally {
      state.isSubmitting = false
      els.btnSubmit.disabled = false
      els.btnSubmit.textContent = '등록'
    }
  }

  function resetForm() {
    els.inputName.value = ''
    els.inputPhone.value = '010-'   // 기본값 복원 (3차 피드백)
    els.inputEmail.value = ''
          // 등록 완료 후 다음 손님을 위해 이름 입력창에 자동으로 커서(포커스) 주기
  setTimeout(() => {
    if (els.inputName) els.inputName.focus();
  }, 500);
  }

  // ============================================================
  // 인증 모달
  // ============================================================

  function openAuthModal(item) {
    state.authTarget = item
    state.verifiedLast4 = null
    els.authTargetName.textContent = item.name
    els.inputLast4.value = ''
    els.authError.hidden = true
    els.modalAuth.hidden = false
    setTimeout(() => els.inputLast4.focus(), 100)
  }

  function cancelAuthModal() {
    els.modalAuth.hidden = true
    els.inputLast4.value = ''
    els.authError.hidden = true
    state.authTarget = null
    state.verifiedLast4 = null
  }

  function hideAuthModalKeepState() {
    els.modalAuth.hidden = true
    els.inputLast4.value = ''
    els.authError.hidden = true
  }

  async function handleAuthConfirm() {
    if (!state.authTarget) return

    const last4 = extractDigits(els.inputLast4.value)
    if (last4.length !== 4) {
      els.authError.textContent = '숫자 4자리를 입력해주세요'
      els.authError.hidden = false
      return
    }

    els.btnAuthConfirm.disabled = true

    try {
      const result = await apiCall('verify', {
        id: state.authTarget.id,
        last4: last4
      })

      if (!result.ok) {
        if (result.error === 'LAST4_MISMATCH') {
          els.authError.textContent = '핸드폰 끝자리 4자리가 맞지 않습니다'
          els.authError.hidden = false
          els.inputLast4.value = ''
          els.inputLast4.focus()
          return
        }
        if (result.error === 'NOT_FOUND') {
          els.authError.textContent = '대기 목록에서 찾을 수 없습니다'
          els.authError.hidden = false
          return
        }
        if (result.error === 'STORED_PHONE_CORRUPTED') {
          els.authError.textContent = '저장된 번호가 비정상입니다\n관리자 앱에서 수정해주세요'
          els.authError.hidden = false
          return
        }
        throw new Error(result.error)
      }

      state.verifiedLast4 = last4
      hideAuthModalKeepState()
      openEditModal(result)
    } catch (err) {
      console.error('verify error:', err)
      els.authError.textContent = translateError(err.message)
      els.authError.hidden = false
    } finally {
      els.btnAuthConfirm.disabled = false
    }
  }

  // ============================================================
  // 수정 모달
  // ============================================================

  function openEditModal(data) {
    els.editName.value = data.name || ''
    els.editPhone.value = data.phone || ''
    els.editEmail.value = data.email || ''
    els.modalEdit.hidden = false
  }

  function closeEditModal() {
    els.modalEdit.hidden = true
    state.authTarget = null
    state.verifiedLast4 = null
    resetForm();
  }

  // 수정 요청은 서버에서 저장까지 끝났는데 응답만 사라지는 경우가 있다 (2026-10-07 성동 실측)
  // 응답이 끊기면 번호 확인으로 실제 저장 여부를 읽어 보고, 저장돼 있으면 성공으로 처리한다
  async function confirmUpdateApplied(id, phone, email) {
    const digits = extractDigits(phone)
    try {
      const r = await apiCall('verify', { id: id, last4: digits.slice(-4) })
      return !!(r && r.ok && extractDigits(String(r.phone || '')) === digits &&
        String(r.email || '').trim() === email)
    } catch (e) {
      return false
    }
  }

  async function saveWithConfirm(payload, phone, email) {
    const started = Date.now()
    const report = (kind, info) => reportEvent(kind, 'update', Object.assign({ ms: Date.now() - started }, info))
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await apiCall('update', payload, { retry: false, silent: true })
        const retryable = !r.ok && RETRYABLE_SERVER_ERRORS.indexOf(r.error) !== -1
        if (r.ok || attempt === 2 || !retryable) {
          if (r.ok && attempt > 1) report('recovered', { attempts: attempt })
          if (retryable) report('failed', { error: r.error, attempts: attempt, detail: r.message })
          return r
        }
      } catch (err) {
        if (!isTransientError(err)) throw err
        if (await confirmUpdateApplied(payload.id, phone, email)) {
          report('confirmed', { error: err.message, attempts: attempt })
          return { ok: true, id: payload.id }
        }
        if (attempt === 2) {
          report('failed', { error: err.message, attempts: attempt })
          throw err
        }
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
  }

  async function handleEditSave() {
    if (!state.authTarget || !state.verifiedLast4) {
      await showMessage('세션이 만료되었습니다 다시 시도해주세요')
      closeEditModal()
      return
    }

    const phone = sanitizeInput(els.editPhone.value)
    const email = sanitizeInput(els.editEmail.value)

    if (!phone) { await showMessage('전화번호를 입력해주세요'); els.editPhone.focus(); return }
    if (!isValidPhoneStrict(phone)) {
      await showMessage('전화번호 8자리 또는 끝번호 4자리를 입력해주세요')
      els.editPhone.focus()
      return
    }
    if (email && !isValidEmail(email)) { await showMessage('이메일 형식이 올바르지 않습니다'); els.editEmail.focus(); return }

    els.btnEditSave.disabled = true

    try {
      const updatePayload = {
        id: state.authTarget.id,
        last4: state.verifiedLast4,
        data: { phone, email }
      }
      const result = await saveWithConfirm(updatePayload, phone, email)

      if (!result.ok) throw serverError(result, 'UPDATE_FAILED')

      showToast('수정 완료', 'success')
      closeEditModal()
      await loadWaitlist()
    } catch (err) {
      console.error('update error:', err)
      await showMessage('수정 실패\n' + errorText(err))
    } finally {
      els.btnEditSave.disabled = false
    }
  }

  // ============================================================
  // 에러 메시지 한글화
  // ============================================================

  function translateError(code) {
    const map = {
      'NAME_REQUIRED': '이름을 입력해주세요',
      'PHONE_REQUIRED': '전화번호를 입력해주세요',
      'PHONE_TOO_SHORT': '전화번호는 4자리 이상이어야 합니다',
      'PHONE_INVALID_LENGTH': '전화번호 8자리 또는 끝번호 4자리를 입력해주세요',
      'PHONE_INVALID_PREFIX': '010으로 시작하는 번호를 입력해주세요',
      'LAST4_INVALID': '숫자 4자리를 입력해주세요',
      'LAST4_MISMATCH': '끝자리가 맞지 않습니다',
      'NOT_FOUND': '대상을 찾을 수 없습니다',
      'UNAUTHORIZED': '인증 실패',
      'TIMEOUT': '응답 시간 초과',
      'CONFIG_NOT_SET': '서버 설정이 필요합니다',
      'SERVER_ERROR': '서버 오류',
      'BUSY': '접수가 몰려 처리하지 못했습니다 잠시 후 다시 눌러주세요',
      'CREATE_FAILED': '등록 중 오류 발생',
      'UPDATE_FAILED': '수정 중 오류 발생',
      'LOAD_FAILED': '불러오기 실패',
      'UNKNOWN_ACTION': '알 수 없는 요청',
      'STORED_PHONE_CORRUPTED': '저장된 번호가 비정상입니다'
    }
    if (!code) return '오류 발생'
    if (code.startsWith('HTTP_')) return '네트워크 오류 (' + code + ')'
    return map[code] || code
  }

  // ============================================================
  // 초기화
  // ============================================================

  function init() {
    if (window.APP_CONFIG && window.APP_CONFIG.DEBUG_BORDER) {
      document.body.classList.add('debug-border')
    }

    els.btnSubmit.addEventListener('click', handleSubmit)
    els.btnCancel.addEventListener('click', resetForm)

    // 등록 폼 전화번호 자동 포매팅 (실시간 - 길이별 하이픈)
    // "010-" 프리필 보호: 사용자가 직접 다 지우지 않는 한 "010-"은 유지
    els.inputPhone.addEventListener('input', (e) => {
      const cursorAtEnd = e.target.selectionStart === e.target.value.length
      const digits = extractDigits(e.target.value)

      // 3자리 이하면서 010으로 시작하는 경우만 "010-" 유지
      // (사용자가 010을 지우는 동작 존중)
      if (digits.length <= 3 && digits === '010'.slice(0, digits.length) && digits.length > 0) {
        e.target.value = digits === '010' ? '010-' : digits
      } else {
        e.target.value = formatPhoneByLength(e.target.value)
      }

      if (cursorAtEnd) {
        const len = e.target.value.length
        e.target.setSelectionRange(len, len)
      }
    })

    // 수정 모달 전화번호 자동 포매팅
    els.editPhone.addEventListener('input', (e) => {
      const cursorAtEnd = e.target.selectionStart === e.target.value.length
      e.target.value = formatPhoneByLength(e.target.value)
      if (cursorAtEnd) {
        const len = e.target.value.length
        e.target.setSelectionRange(len, len)
      }
    })

    els.btnRefresh.addEventListener('click', loadWaitlist)

    els.btnAuthConfirm.addEventListener('click', handleAuthConfirm)
    els.btnAuthCancel.addEventListener('click', cancelAuthModal)

    els.inputLast4.addEventListener('input', (e) => {
      e.target.value = extractDigits(e.target.value).slice(0, 4)
      els.authError.hidden = true
    })
    els.inputLast4.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAuthConfirm()
    })

    els.btnEditSave.addEventListener('click', handleEditSave)
    els.btnEditCancel.addEventListener('click', closeEditModal)

    els.btnMessageOk.addEventListener('click', () => {
      els.modalMessage.hidden = true
      if (messageResolve) { messageResolve(); messageResolve = null }
    })

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!els.modalAuth.hidden) cancelAuthModal()
        else if (!els.modalEdit.hidden) closeEditModal()
        else if (!els.modalMessage.hidden) {
          els.modalMessage.hidden = true
          if (messageResolve) { messageResolve(); messageResolve = null }
        }
      }
    })

    if (window.APP_CONFIG && window.APP_CONFIG.AUTO_REFRESH_MS > 0) {
      setInterval(() => {
        if (els.modalAuth.hidden && els.modalEdit.hidden && els.modalMessage.hidden) {
          loadWaitlist()
        }
      }, window.APP_CONFIG.AUTO_REFRESH_MS)
    }

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
          console.warn('SW registration failed:', err)
        })
      })
    }

    loadWaitlist()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
