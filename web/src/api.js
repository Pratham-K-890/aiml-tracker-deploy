const SERVER = import.meta.env.VITE_API_URL ?? '';

export const TRACKER  = `${SERVER}/api/tracker`;
export const CHATBOT  = `${SERVER}/chatbot`;

export function getToken() {
  return localStorage.getItem('auth_token');
}

export function setToken(t) {
  localStorage.setItem('auth_token', t);
}

export function clearToken() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('user_role');
}

export function authHeaders(json = true) {
  const h = { Authorization: `Bearer ${getToken()}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function request(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await res.text();
    if (!res.ok) throw new Error(text.replace(/<[^>]+>/g, '').slice(0, 300).trim() || `HTTP ${res.status}`);
    return text;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
  return data;
}

// ── Me / Auth ─────────────────────────────────────────────────────────────────
export const getMe = () =>
  request(TRACKER + '/me', { headers: authHeaders() });

// ── Batches ──────────────────────────────────────────────────────────────────
export const getBatches = () =>
  request(TRACKER + '/batches', { headers: authHeaders() });

export const createBatch = (batch_name, year) =>
  request(TRACKER + '/batches', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ batch_name, year: year ? parseInt(year) : null }),
  });

export const deleteBatch = (batchId) =>
  request(`${TRACKER}/batches/${batchId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

// ── Semesters ────────────────────────────────────────────────────────────────
export const getSemesters = (batchId) =>
  request(`${TRACKER}/batches/${batchId}/semesters`, { headers: authHeaders() });

export const createSemester = (batchId, sem_number) =>
  request(`${TRACKER}/batches/${batchId}/semesters`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sem_number }),
  });

export const deleteSemester = (semId) =>
  request(`${TRACKER}/semesters/${semId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

export const clearSemesterProjects = (semId) =>
  request(`${TRACKER}/semesters/${semId}/projects`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

export const updateSemesterStatus = (semId, project_status, project_active) =>
  request(`${TRACKER}/semesters/${semId}/status`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ project_status, project_active: project_active ?? null }),
  });

// ── Courses ──────────────────────────────────────────────────────────────────
export const getCourses = (semId) =>
  request(`${TRACKER}/semesters/${semId}/courses`, { headers: authHeaders() });

export const createCourse = (semId, course_name, course_code) =>
  request(`${TRACKER}/semesters/${semId}/courses`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ course_name, ...(course_code ? { course_code } : {}) }),
  });

export const deleteCourse = (courseId) =>
  request(`${TRACKER}/courses/${courseId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

// ── Projects ─────────────────────────────────────────────────────────────────
export const getProjects = (courseId) =>
  request(`${TRACKER}/courses/${courseId}/projects`, { headers: authHeaders() });

export const getProject = (projectId) =>
  request(`${TRACKER}/projects/${projectId}`, { headers: authHeaders() });

export const createProject = (courseId, payload) =>
  request(`${TRACKER}/courses/${courseId}/projects`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

export const updateProject = (projectId, payload) =>
  request(`${TRACKER}/projects/${projectId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

export const deleteProject = (projectId) =>
  request(`${TRACKER}/projects/${projectId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

// ── Students ─────────────────────────────────────────────────────────────────
export const updateStudent = (studentId, payload) =>
  request(`${TRACKER}/students/${studentId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

export const deleteStudent = (studentId) =>
  request(`${TRACKER}/students/${studentId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

// ── Teams & assignments ───────────────────────────────────────────────────────
export const getTeachers = () =>
  request(TRACKER + '/teachers', { headers: authHeaders() });

export const isCourseCoordinator = (courseId) =>
  request(`${TRACKER}/courses/${courseId}/is-coordinator`, { headers: authHeaders() });

export const createTeam = (courseId, payload) =>
  request(`${TRACKER}/courses/${courseId}/teams`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

export async function uploadCourseExcel(courseId, file) {
  const form = new FormData();
  form.append('file', file);
  return request(`${TRACKER}/courses/${courseId}/upload-excel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
}

export const courseTemplateUrl = (courseId) =>
  `${TRACKER}/courses/${courseId}/download-course-template`;

export const assignGuide = (projectId, userId) =>
  request(`${TRACKER}/projects/${projectId}/guide`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ user_id: userId || null }),
  });

export const addExaminer = (projectId, userId) =>
  request(`${TRACKER}/projects/${projectId}/examiners`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ user_id: userId }),
  });

export const removeExaminer = (projectId, userId) =>
  request(`${TRACKER}/projects/${projectId}/examiners/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

export const getMyGuideTeams = (courseId) =>
  request(`${TRACKER}/courses/${courseId}/my-guide-teams`, { headers: authHeaders() });

export const getMyExamTeams = (courseId) =>
  request(`${TRACKER}/courses/${courseId}/my-exam-teams`, { headers: authHeaders() });

// ── Upload ───────────────────────────────────────────────────────────────────
export async function uploadExcel(projectId, file) {
  const form = new FormData();
  form.append('file', file);
  return request(`${TRACKER}/projects/${projectId}/upload-excel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
}

export const templateUrl = () => `${TRACKER}/download-template`;

// ── README ───────────────────────────────────────────────────────────────────
export const getReadme = (projectId) =>
  request(`${TRACKER}/projects/${projectId}/readme`, { headers: authHeaders() });

// ── Chatbot ──────────────────────────────────────────────────────────────────
export const chatFilter = (query, previousFilter = null) =>
  request(`${CHATBOT}/filter`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ query, ...(previousFilter ? { previous_filter: previousFilter } : {}) }),
  });

export const chatExplain = (projectId) =>
  request(`${CHATBOT}/explain/${projectId}`, {
    method: 'POST',
    headers: authHeaders(),
  });

export const chatSuggest = (projectId) =>
  request(`${CHATBOT}/suggest/${projectId}`, {
    method: 'POST',
    headers: authHeaders(),
  });

// ── Admin: account management ─────────────────────────────────────────────────
export const createTeacher = (name, email, password, role) =>
  request(`${SERVER}/api/auth/admin/create-teacher`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, email, password, role }),
  });

export const createStudent = (name, email, password, usn) =>
  request(`${SERVER}/api/auth/admin/create-student`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, email, password, usn }),
  });

export async function previewStudents(file) {
  const form = new FormData();
  form.append('file', file);
  return request(`${SERVER}/api/auth/admin/preview-students`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
}

export async function uploadStudents(file) {
  const form = new FormData();
  form.append('file', file);
  return request(`${SERVER}/api/auth/admin/upload-students`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
}

export const deleteUser = (userId) =>
  request(`${SERVER}/api/auth/admin/users/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

export const adminResetPassword = (userId, newPassword) =>
  request(`${SERVER}/api/auth/admin/users/${userId}/reset-password`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_password: newPassword }),
  });

// ── Reviews ───────────────────────────────────────────────────────────────────
export const getReviews = (courseId) =>
  request(`${TRACKER}/courses/${courseId}/reviews`, { headers: authHeaders() });

export const createReview = (courseId, payload) =>
  request(`${TRACKER}/courses/${courseId}/reviews`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

export const updateReview = (reviewId, payload) =>
  request(`${TRACKER}/reviews/${reviewId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

export const deleteReview = (reviewId) =>
  request(`${TRACKER}/reviews/${reviewId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

// ── Evaluation ───────────────────────────────────────────────────────────────
export const getEvalReviews = (courseId) =>
  request(`${TRACKER}/courses/${courseId}/evaluation-reviews`, { headers: authHeaders() });

export const toggleEvalReviewLock = (evalReviewId, isLocked) =>
  request(`${TRACKER}/evaluation-reviews/${evalReviewId}/lock`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ is_locked: isLocked }),
  });

export const getMyEvalMarks = (evalReviewId, projectId) =>
  request(`${TRACKER}/evaluation-reviews/${evalReviewId}/my-marks/${projectId}`, {
    headers: authHeaders(),
  });

export const submitEvalMarks = (evalReviewId, projectId, marks) =>
  request(`${TRACKER}/evaluation-reviews/${evalReviewId}/marks/${projectId}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(marks),
  });

export const getEvalReviewSummary = (evalReviewId) =>
  request(`${TRACKER}/evaluation-reviews/${evalReviewId}/summary`, { headers: authHeaders() });

// ── Course documents ──────────────────────────────────────────────────────────
export const getDocs = (courseId) =>
  request(`${TRACKER}/courses/${courseId}/docs`, { headers: authHeaders() });

export async function uploadDoc(courseId, file) {
  const form = new FormData();
  form.append('file', file);
  return request(`${TRACKER}/courses/${courseId}/docs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
}

export const deleteDoc = (docId) =>
  request(`${TRACKER}/docs/${docId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

export async function downloadCESheet(courseId) {
  const res = await fetch(`${TRACKER}/courses/${courseId}/download-ce-sheet`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.replace(/<[^>]+>/g, '').slice(0, 200).trim() || `HTTP ${res.status}`);
  }
  return res.blob();
}

export async function downloadMarksExcel(courseId) {
  const res = await fetch(`${TRACKER}/courses/${courseId}/download-marks-excel`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.replace(/<[^>]+>/g, '').slice(0, 200).trim() || `HTTP ${res.status}`);
  }
  return res.blob();
}

// ── Admin: users + coordinators ───────────────────────────────────────────────
export const getAdminUsers = () =>
  request(`${TRACKER}/admin/users`, { headers: authHeaders() });


export const getAdminCourses = () =>
  request(`${TRACKER}/admin/courses`, { headers: authHeaders() });

export const getAdminCoordinators = () =>
  request(`${TRACKER}/admin/coordinators`, { headers: authHeaders() });

export const assignCoordinator = (user_id, course_id) =>
  request(`${TRACKER}/admin/assign-coordinator`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ user_id, course_id }),
  });

export const removeCoordinator = (course_id, user_id) =>
  request(`${TRACKER}/admin/coordinators/${course_id}/${user_id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
