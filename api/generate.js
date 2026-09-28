module.exports = async function handler(req, res) {
  // CORS 설정
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

  // Vercel 환경변수에서 키를 읽어옵니다.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return res.status(500).json({
      error: 'Vercel에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Settings -> Environment Variables를 확인해주세요.'
    });
  }

  const { fixedSchedules, priorities, wakeSleepTime, notes } = req.body || {};

  if (!fixedSchedules || fixedSchedules.trim() === '') {
    return res.status(400).json({ error: '고정 일정 정보를 전달해주세요.' });
  }

  const prompt = `
당신은 프리랜서 강사를 위한 개인 맞춤형 지능형 루틴 설계사입니다.
불규칙한 강의 일정 사이에 공부, 강의준비, 운동, 이동 시간, 휴식을 최적으로 배치해 하루 시간표를 작성하세요.

[사용자 스케줄]
- 활동 가능 시간: ${wakeSleepTime || '07:30 - 23:30'}
- 고정 일정(강의/미팅): ${fixedSchedules}
- 채우고 싶은 루틴: ${priorities || '운동, 공부, 강의 준비'}
- 메모/요구사항: ${notes || '없음'}

[원칙]
1. 반드시 순수한 JSON 형식으로만 응답하세요. 마크다운(\`\`\`)이나 추가 설명 문장은 절대 붙이지 마세요.
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

  // 사용자 계정 카탈로그에 존재하는 공식 최신 Flash 모델
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: errData.error?.message || `HTTP ${response.status} 오류 발생`
      });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return res.status(500).json({ error: '모델 응답 본문이 비어 있습니다.' });
    }

    const parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message || '서버 처리 중 오류가 발생했습니다.' });
  }
};