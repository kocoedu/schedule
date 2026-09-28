module.exports = async function handler(req, res) {
  // CORS 및 HTTP 메서드 설정
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. 서버 환경변수 키 확인
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return res.status(500).json({
      error: 'Vercel 환경변수에 GEMINI_API_KEY가 등록되어 있지 않습니다. Vercel Settings -> Environment Variables를 확인해주세요.'
    });
  }

  // 2. 요청 본문 파싱
  const { fixedSchedules, priorities, wakeSleepTime, notes } = req.body || {};

  if (!fixedSchedules || fixedSchedules.trim() === '') {
    return res.status(400).json({ error: '고정 일정 정보를 전달해주세요.' });
  }

  // 3. 최적화 프롬프트 작성
  const prompt = `
당신은 프리랜서 강사를 위한 개인 맞춤형 지능형 루틴 설계사입니다.
불규칙한 강의 일정 사이에 공부, 강의준비, 운동, 이동 시간, 휴식을 최적으로 배치해 하루 시간표를 작성하세요.

[사용자 스케줄]
- 활동 가능 시간: ${wakeSleepTime || '07:30 - 23:30'}
- 고정 일정(강의/미팅): ${fixedSchedules}
- 채우고 싶은 루틴: ${priorities || '운동, 공부, 강의 준비'}
- 메모/요구사항: ${notes || '없음'}

[원칙]
1. 반드시 순수한 JSON 형식으로만 응답하세요. 마크다운(\`\`\`)이나 추가 설명 문장은 붙이지 마세요.
2. category 필드는 반드시 다음 6가지 중 하나만 사용하세요: ["강의", "강의준비", "공부", "운동", "이동", "휴식/식사"]
3. 강의 전후 이동 시간 및 현장 세팅/마무리 버퍼(최소 20~30분)를 반드시 확보하세요.
4. 강의 직후는 에너지 소진이 크므로 뇌를 식힐 수 있는 휴식 또는 가벼운 스트레칭을 배치하세요.
5. 높은 집중력이 필요한 작업(교재 연구, 심화 공부)은 비는 골든 타임에 배치하세요.

[반환 JSON 규격]
{
  "summary": "오늘 하루 루틴 운용을 위한 전략적 조언 한 줄",
  "schedule": [
    {
      "time": "08:00 - 09:00",
      "activity": "활동 내용",
      "category": "강의준비",
      "tip": "실행을 돕는 구체적 팁"
    }
  ]
}
`;

  const requestPayload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  // 과부하 시 순차 우회할 모델 우선순위 풀
  const models = ['gemini-3-flash-preview', 'gemini-3.8-flash'];
  let lastErrorMsg = '';

  for (let i = 0; i < models.length; i++) {
    const currentModel = models[i];
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      if (response.ok) {
        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) {
          throw new Error('응답 본문이 비어 있습니다.');
        }

        // 마크다운 블록 기호 제거 후 JSON 파싱
        const parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
        return res.status(200).json(parsed);
      }

      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.error?.message || `HTTP ${response.status} (${response.statusText})`;
      lastErrorMsg = errMsg;

      // 트래픽 과부하(High demand, 429, 503) 시 다음 모델로 폴백
      const isOverloaded = errMsg.includes('high demand') || response.status === 429 || response.status === 503;
      if (isOverloaded && i < models.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      // 키 오류(400/403) 등 즉시 반환해야 하는 오류
      if (!isOverloaded) {
        return res.status(response.status).json({ error: errMsg });
      }
    } catch (err) {
      lastErrorMsg = err.message;
      if (i < models.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
    }
  }

  return res.status(500).json({
    error: `모델 호출 실패: ${lastErrorMsg || '일시적 서버 과부하 상태입니다. 잠시 후 다시 시도해주세요.'}`
  });
};