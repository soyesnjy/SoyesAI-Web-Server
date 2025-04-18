// stream 데이터 처리
const stream = require("stream");
// MySQL 접근
const mysql = require("mysql");
const { dbconfig_ai } = require("../DB/database");

// Redis 연결
// const redisStore = require("../DB/redisClient");

// 결과보고서 관련
const puppeteer = require("puppeteer");
const ejs = require("ejs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");

// AI DB 연결
const connection_AI = mysql.createConnection(dbconfig_ai);
connection_AI.connect();

const axios = require("axios");

const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.API_TOKEN,
});

const nodemailer = require("nodemailer");
// 구글 권한 관련
const { google } = require("googleapis");

// GCP IAM 서비스 계정 인증
const serviceAccount = {
  private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  project_id: process.env.GOOGLE_PROJECT_ID,
};

const auth_youtube = new google.auth.JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"],
});

const auth_google_drive = new google.auth.JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const youtube = google.youtube({
  version: "v3",
  auth: auth_youtube,
});

const drive = google.drive({ version: "v3", auth: auth_google_drive });

// 동기식 DB 접근 함수 1. Promise 생성 함수
function queryAsync(connection, query, parameters) {
  return new Promise((resolve, reject) => {
    connection.query(query, parameters, (error, results, fields) => {
      if (error) {
        reject(error);
      } else {
        resolve(results);
      }
    });
  });
}
// 프로미스 resolve 반환값 사용. (User Data return)
async function fetchUserData(connection, query) {
  try {
    let results = await queryAsync(connection, query, []);
    // console.log(results[0]);
    return results;
  } catch (error) {
    console.error(error);
  }
}

// 심리 검사 관련
const {
  persnal_short, // 성격검사 짧은 결과
  persnal_long, // 성격검사 양육 코칭 결과
  ebt_School_Result,
  // ebt_Friend_Result,
  // ebt_Family_Result,
  // ebt_Mood_Result,
  // ebt_Unrest_Result,
  // ebt_Sad_Result,
  // ebt_Health_Result,
  // ebt_Attention_Result,
  // ebt_Movement_Result,
  // ebt_Angry_Result,
  // ebt_Self_Result,
  ebt_Analysis,
} = require("../DB/psy_test");

// const {
//   base_pupu,
//   base_soyes,
//   base_lala,
//   base_pupu_v2,
// } = require("../DB/base_prompt");

// 프롬프트 관련
const {
  persona_prompt_pupu,
  persona_prompt_lala,
  persona_prompt_ubi,
  persona_prompt_soyes,
  adler_prompt,
  gestalt_prompt,
  info_prompt,
  prevChat_prompt,
  solution_prompt,
  solution_prompt2,
  psyResult_prompt,
  common_prompt,
  sentence_division_prompt,
  completions_emotion_prompt,
  test_prompt_20240304,
  test_prompt_20240304_v2,
  test_prompt_20240305_v1,
  no_req_prompt,
  persnal_result_prompt,
  ebt_analysis_prompt,
  ebt_analysis_prompt_v2,
  ebt_analysis_prompt_v3,
  ebt_analysis_prompt_v4,
  ebt_analysis_prompt_v5,
  ebt_analysis_prompt_v6,
  ebt_analysis_prompt_v7,
  ebt_analysis_prompt_v8,
  pt_analysis_prompt,
  test_prompt_20240402,
  persona_prompt_lala_v2,
  persona_prompt_lala_v3,
  persona_prompt_lala_v4,
  persona_prompt_lala_v5,
  solution_matching_persona_prompt,
  persona_prompt_pupu_v2,
  persona_prompt_pupu_v3,
  persona_prompt_pupu_v4,
  persona_prompt_pupu_v5,
} = require("../DB/test_prompt");

// 인지행동 검사 관련
const {
  ebtResultMap,
  ptResultMap,
  friendMap,
  careerMap,
  carrerTypeMap,
} = require("../DB/report_data");

// 텍스트 감지 관련
const {
  test_result_ment,
  cb_solution_ment,
} = require("../DB/detect_ment_Array");

const {
  cognitive_prompt,
  diary_prompt,
  balance_prompt,
} = require("../DB/solution_prompt");

// Database Table Info
const {
  User_Table_Info,
  EBT_Table_Info,
  PT_Table_Info,
  CT_Table_Info,
  Consult_Table_Info,
  Ella_Training_Table_Info,
  North_Table_Info,
} = require("../DB/database_table_info");

const EBT_classArr = [
  "School",
  "Friend",
  "Family",
  "Mood",
  "Unrest",
  "Sad",
  "Health",
  "Attention",
  "Movement",
  "Angry",
  "Self",
];

// New EBT Result Select Method
const select_soyesAI_EbtResult_v2 = async (keyValue, contentKey, parsepUid) => {
  try {
    // New EBT Table
    const table = EBT_Table_Info["All"].table;
    const { pKey, cKey, status, created_at, analysis, score } =
      EBT_Table_Info["All"].attribute;

    // 조건부 Select Query
    const select_query = keyValue
      ? `SELECT * FROM ${table} WHERE (${pKey} ='${keyValue}' AND ${status}='1')` // keyValue 값으로 조회하는 경우
      : `SELECT * FROM ${table} WHERE (${cKey} ='${parsepUid}' AND ${status}='1') ORDER BY ${created_at} DESC LIMIT 1`; // 가장 최근 검사 결과를 조회하는 경우

    // const select_query = `SELECT * FROM ${table} WHERE ${attribute.pKey}='${parsepUid}'`; // Select Query
    const ebt_data = await fetchUserData(connection_AI, select_query);
    // console.log(ebt_data[0]);

    // 검사를 진행하지 않은 경우
    if (!ebt_data[0]) return [];

    // tScore 계산 + 검사 결과 +
    const resultArr = EBT_classArr.map((type) => {
      const { average, standard, danger_score, caution_score } =
        EBT_Table_Info[type];
      // 검사 스코어 합 + T점수 계산
      const scoreSum = ebt_data[0][score[type]]
        .split("/")
        .reduce((acc, cur) => Number(acc) + Number(cur));
      const tScore = (((scoreSum - average) / standard) * 10 + 50).toFixed(2);
      // 검사 결과
      const result =
        danger_score <= scoreSum
          ? "경고"
          : caution_score <= scoreSum
          ? "주의"
          : "양호";

      return {
        ebt_class: type,
        testStatus: true,
        scoreSum,
        tScore: Number(tScore),
        result,
        content: contentKey ? ebt_data[0][analysis[type]] : "",
      };
    });

    // console.log(resultArr);

    return resultArr;
  } catch (err) {
    console.log(err);
    return "Error";
  }
};

const openAIController = {
  // 감정 분석 AI
  postOpenAIEmotionAnalyze: async (req, res) => {
    const { messageArr } = req.body;
    console.log("감정 분석 API /emotion Path 호출");
    // console.log(req.body);
    // console.log(typeof messageArr);

    let parseMessageArr;

    try {
      // messageArr가 문자열일 경우 json 파싱
      if (typeof messageArr === "string") {
        parseMessageArr = JSON.parse(messageArr);
      } else parseMessageArr = [...messageArr];

      const response = await openai.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              "너는 감정 판별사야. 앞으로 입력되는 유저 메세지를 긍정/부정/중립 3가지 상태 중 하나로 판단해줘. 대답은 반드시 긍정,부정,중립 3개 중 하나로만 해줘.",
          },
          ...parseMessageArr,
        ],
        model: "gpt-3.5-turbo-0125",
      });

      // console.log(response.choices[0]);

      const message = { message: response.choices[0].message.content };
      res.send(message);
    } catch (err) {
      // console.error(err.error);
      res.send(err);
    }
  },
  // EBT 결과 분석 및 DB 저장 및 메일 전송 API
  postOpenAIPsychologicalAnalysis: async (req, res) => {
    const { EBTData } = req.body; // 클라이언트 한계로 데이터 묶음으로 받기.
    // console.log(EBTData);

    let parseEBTdata,
      parseMessageArr,
      parsingScore,
      parsingType,
      parsepUid,
      yourMailAddr = "",
      myMailAddr = "",
      myMailPwd = "";

    // 테스트 타입 객체. 추후 검사를 늘림에 따라 추가 될 예정
    const testType = {
      School: "학교생활",
      Friend: "또래관계",
      Family: "가족관계",
      Mood: "전반적 기분",
      Unrest: "불안",
      Sad: "우울",
      Health: "신체증상",
      Attention: "주의 집중",
      Movement: "과잉 행동",
      Angry: "분노",
      Self: "자기인식",
      Persnal: "성격검사",
      default: "학교생활",
    };

    try {
      // 파싱. Client JSON 데이터
      if (typeof EBTData === "string") {
        parseEBTdata = JSON.parse(EBTData);
      } else parseEBTdata = EBTData;

      const { messageArr, type, score, pUid } = parseEBTdata;

      // No type => return
      if (!type) {
        console.log("No type input value - 400");
        return res.status(400).json({ message: "No type input value - 400" });
      }

      // type값이 EBT_classArr에 속하지 않을 경우
      if (!EBT_classArr.includes(type)) {
        console.log("type is not includes EBT_classArr - 404");
        return res
          .status(404)
          .json({ message: "type is not includes EBT_classArr - 404" });
      }

      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.status(400).json({ message: "No pUid input value - 400" });
      }

      // No messageArr => return
      if (!messageArr) {
        console.log("No messageArr input value - 400");
        return res
          .status(400)
          .json({ message: "No messageArr input value - 400" });
      }

      // No score => return
      if (!score) {
        console.log("No score input value - 400");
        return res.status(400).json({ message: "No score input value - 400" });
      }

      // 파싱. Client JSON 데이터
      if (typeof messageArr === "string") {
        parseMessageArr = JSON.parse(messageArr);
      } else parseMessageArr = messageArr;

      if (typeof score === "string") {
        parsingScore = JSON.parse(score);
      } else parsingScore = score;

      parsingType = type;
      parsepUid = pUid;

      console.log(
        `EBT 테스트 결과 분석 및 메일 전송 API /analysis Path 호출 - pUid:${parsepUid}`
      );

      // T점수 계산
      const scoreSum = parsingScore.reduce((acc, cur) => acc + cur);
      const aver = EBT_Table_Info[parsingType].average;
      const stand = EBT_Table_Info[parsingType].standard;
      const tScore = (((scoreSum - aver) / stand) * 10 + 50).toFixed(2);
      // 검사 결과
      const result =
        EBT_Table_Info[parsingType].danger_score <= scoreSum
          ? "경고"
          : EBT_Table_Info[parsingType].caution_score <= scoreSum
          ? "주의"
          : "양호";
      console.log("tScore: " + tScore);
      console.log("result: " + result);
      const analysisPrompt = [];
      const userPrompt = [];

      // 정서행동 검사 분석가 페르소나 v8 - 0819
      analysisPrompt.push(ebt_analysis_prompt_v8);
      // 분야별 결과 해석 프롬프트
      analysisPrompt.push(ebt_Analysis[parsingType]);
      // 결과 해석 요청 프롬프트
      const ebt_class = testType[parsingType];
      userPrompt.push({
        role: "user",
        content: `
        user의 ${ebt_class} 심리 검사 결과는 '${result}'에 해당한다.
        user의 T점수는 ${tScore}점이다.
        다음 문단은 user의 ${ebt_class} 심리 검사 문항에 대한 응답이다.
        '''
        ${parseMessageArr.map((el) => el.content).join("\n")}
        '''
        위 응답을 기반으로 user의 ${ebt_class}에 대해 해석하라.
        `,
      });

      /*
      const user_table = "soyes_ai_User";
      const user_attr = {
        pKey: "uid",
        attr1: "email",
      };

      const select_query = `SELECT * FROM ${user_table} WHERE ${user_attr.pKey}='${pUid}'`;
      await fetchUserData(connection_AI, select_query);
      console.log("받는사람: " + yourMailAddr);

      yourMailAddr = "soyesnjy@gmail.com"; // dummy email. 받는사람
      
      // 보내는 사람 계정 로그인
      myMailAddr = process.env.ADDR_MAIL; // 보내는 사람 메일 주소
      myMailPwd = process.env.ADDR_PWD; // 구글 계정 2단계 인증 비밀번호

      const transporter = nodemailer.createTransport({
        service: "gmail", // 사용할 이메일 서비스
        // host: "smtp.gmail.com",
        // port: 587,
        // secure: false,
        auth: {
          user: myMailAddr, // 보내는 이메일 주소
          pass: myMailPwd, // 이메일 비밀번호
        },
      });
      */

      // AI 분석
      const response = await openai.chat.completions.create({
        messages: [...analysisPrompt, ...userPrompt],
        model: "gpt-4o", // gpt-4-turbo, gpt-4-0125-preview, gpt-4-1106-preview, gpt-3.5-turbo-1106, gpt-3.5-turbo-instruct(Regercy), ft:gpt-3.5-turbo-1106:personal::8fIksWK3
        temperature: 1,
      });

      const message = { message: response.choices[0].message.content };
      // AI 분석 내용 보기좋게 정리
      const analyzeMsg = message.message.split(". ").join(".\n");
      // client 전송
      res.json({ message: analyzeMsg });

      // 메일 제목 및 내용 + 보내는사람 + 받는사람
      const mailOptions = {
        from: myMailAddr,
        to: yourMailAddr,
        subject: "정서행동 검사 AI 상담 분석 결과입니다",
        text: `${analyzeMsg}`,
        // attachments : 'logo.png' // 이미지 첨부 속성
      };

      // 메일 전송 (비동기)
      // transporter.sendMail(mailOptions, function (error, info) {
      //   if (error) {
      //     console.log("Mail Send Fail!");
      //     res.json("Mail Send Fail!");
      //   } else {
      //     console.log("Mail Send Success!");
      //     console.log(info.envelope);
      //   }
      // });

      // 검사 결과가 갱신 되었기에 정서 결과 세션 삭제
      delete req.session.psy_testResult_promptArr_last;

      /* 2024-08-20 - new DB 저장 */
      if (true) {
        const table = EBT_Table_Info["All"].table;
        const { pKey, cKey, analysis, score, status, created_at } =
          EBT_Table_Info["All"].attribute;

        // soyes_ai_Ebt Table 삽입
        // 1. SELECT TEST (row가 있는지 없는지 검사)
        const select_query = `SELECT ${pKey}, ${status} FROM ${table} WHERE uid ='${parsepUid}' ORDER BY ${created_at} DESC LIMIT 1`;
        const ebt_data = await fetchUserData(connection_AI, select_query);

        // console.log(ebt_data[0]);

        // 2. UPDATE TEST
        if (ebt_data[0] && !ebt_data[0][status]) {
          const update_query = `UPDATE ${table} SET ${analysis[type]}=?, ${score[type]}=?, ${status}=? WHERE ${pKey} = ?`;
          // console.log(update_query);

          const update_value = [
            analyzeMsg, // AI 분석 결과
            parsingScore.join("/"), // Score Array String
            type === "Self" ? 1 : 0, // type === Self 일 경우 row 완성 표시
            ebt_data[0].ebt_id, // pKey 값
          ];
          // console.log(update_value);

          connection_AI.query(
            update_query,
            update_value,
            (error, rows, fields) => {
              if (error) console.log(error);
              else console.log("AI Analysis Data DB UPDATE Success!");
            }
          );
        }
        // 3. INSERT TEST
        else {
          const insert_query = `INSERT INTO ${table} (${cKey}, ${analysis[type]}, ${score[type]}) VALUES (?, ?, ?)`;
          // console.log(insert_query);

          const insert_value = [parsepUid, analyzeMsg, parsingScore.join("/")];
          // console.log(insert_value);

          connection_AI.query(
            insert_query,
            insert_value,
            (error, rows, fields) => {
              if (error) console.log(error);
              else console.log("AI Analysis Data DB INSERT Success!");
            }
          );
        }
      }

      /* DB 저장 (구) */
      // if (false) {
      //   /* TODO# New EBT Table SQL 변경 예정 */
      //   const table = EBT_Table_Info[parsingType].table;
      //   const attribute = EBT_Table_Info[parsingType].attribute;
      //   // 오늘 날짜 변환
      //   const dateObj = new Date();
      //   const year = dateObj.getFullYear();
      //   const month = ("0" + (dateObj.getMonth() + 1)).slice(-2);
      //   const day = ("0" + dateObj.getDate()).slice(-2);
      //   const date = `${year}-${month}-${day}`;

      //   // soyes_ai_Ebt Table 삽입
      //   // 1. SELECT TEST (row가 있는지 없는지 검사)
      //   const select_query = `SELECT * FROM ${table} WHERE ${attribute.pKey}='${parsepUid}'`;
      //   const ebt_data = await fetchUserData(connection_AI, select_query);

      //   // 2. UPDATE TEST (row값이 있는 경우 실행)
      //   if (ebt_data[0]) {
      //     const update_query = `UPDATE ${table} SET ${Object.values(attribute)
      //       .filter((el) => el !== "uid")
      //       .map((el) => {
      //         return `${el} = ?`;
      //       })
      //       .join(", ")} WHERE ${attribute.pKey} = ?`;
      //     // console.log(update_query);

      //     const update_value = [
      //       ...parsingScore,
      //       JSON.stringify({ ...mailOptions, date }),
      //       date,
      //       parsepUid,
      //     ];

      //     // console.log(update_value);

      //     connection_AI.query(
      //       update_query,
      //       update_value,
      //       (error, rows, fields) => {
      //         if (error) console.log(error);
      //         else console.log("AI Analysis Data DB UPDATE Success!");
      //       }
      //     );
      //   }
      //   // 3. INSERT TEST (row값이 없는 경우 실행)
      //   else {
      //     const insert_query = `INSERT INTO ${table} (${Object.values(
      //       attribute
      //     ).join(", ")}) VALUES (${Object.values(attribute)
      //       .map((el) => "?")
      //       .join(", ")})`;
      //     // console.log(insert_query);

      //     const insert_value = [
      //       parsepUid,
      //       ...parsingScore,
      //       JSON.stringify({ ...mailOptions, date }),
      //       date,
      //     ];
      //     // console.log(insert_value);

      //     connection_AI.query(
      //       insert_query,
      //       insert_value,
      //       (error, rows, fields) => {
      //         if (error) console.log(error);
      //         else console.log("AI Analysis Data DB INSERT Success!");
      //       }
      //     );
      //   }

      //   // soyes_ai_Ebt_Log Table 삽입
      //   const table_log = EBT_Table_Info["Log"].table; // 해당 table은 soyes_ai_User table과 외래키로 연결된 상태
      //   const attribute_log = EBT_Table_Info["Log"].attribute;

      //   const log_insert_query = `INSERT INTO ${table_log} (${Object.values(
      //     attribute_log
      //   ).join(", ")}) VALUES (${Object.values(attribute_log)
      //     .map((el) => "?")
      //     .join(", ")})`;
      //   // console.log(insert_query);

      //   const log_insert_value = [
      //     parsepUid,
      //     date,
      //     JSON.stringify({ ...mailOptions, date }),
      //     type,
      //     tScore,
      //   ];
      //   // console.log(insert_value);

      //   connection_AI.query(log_insert_query, log_insert_value, (err) => {
      //     if (err) {
      //       console.log("AI Analysis Data LOG DB INSERT Fail!");
      //       console.log("Err sqlMessage: " + err.sqlMessage);
      //     } else console.log("AI Analysis Data LOG DB INSERT Success!");
      //   });

      //   // Todo => soyes_ai_Ebt_Result row 저장

      //   // const ebt_result_table = Consult_Table_Info["Analysis"].table;
      //   // const ebt_result_attribute = Consult_Table_Info["Analysis"].attribute;

      //   // // DB에 Row가 없을 경우 INSERT, 있으면 지정한 속성만 UPDATE
      //   // const duple_query = `INSERT INTO ${ebt_result_table} (${ebt_result_attribute.pKey}, ${ebt_result_attribute.attr1}) VALUES (?, ?) ON DUPLICATE KEY UPDATE
      //   //   ${ebt_result_attribute.attr1} = VALUES(${ebt_result_attribute.attr1});`;

      //   // const duple_value = [parsepUid, JSON.stringify(message)];

      //   // connection_AI.query(duple_query, duple_value, (error, rows, fields) => {
      //   //   if (error) console.log(error);
      //   //   else console.log("Ella Consult Analysis UPDATE Success!");
      //   // });
      // }
    } catch (err) {
      console.log(err.sqlMessage);
      res.status(500).json({ message: "Server Error - 500 Bad Gateway" });
    }
  },
  // PT 결과 DB 저장 API
  postOpenAIPernalTestAnalysis: async (req, res) => {
    const { PTDataSend } = req.body; // 클라이언트 한계로 데이터 묶음으로 받기.

    let parsePTData, parsePTResult;

    try {
      // 파싱. Client JSON 데이터
      if (typeof PTDataSend === "string") {
        parsePTData = JSON.parse(PTDataSend);
      } else parsePTData = PTDataSend;

      console.log(parsePTData);
      const { resultText, pUid } = parsePTData;

      // No type => return
      if (!resultText) {
        console.log("No resultText input value - 400");
        return res.json({ message: "No resultText input value - 400" });
      }

      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.json({ message: "No pUid input value - 400" });
      }

      parsepUid = pUid;
      parsePTResult = resultText;

      console.log(
        `PT 테스트 결과 분석 및 메일 전송 API /analysis_pt Path 호출 - pUid: ${parsepUid}`
      );

      const analysisPrompt = [];
      const userPrompt = [];

      // 성격 검사용 프롬프트 구분
      analysisPrompt.push(pt_analysis_prompt);
      userPrompt.push({
        role: "user",
        content: `다음 문단은 아동의 성격검사 결과야.
          '''
          아동의 성격 검사 유형은 ${parsePTResult}입니다.
          ${parsePTResult} 유형은 ${persnal_short[parsePTResult]}
          '''
          아동의 성격검사 결과를 바탕으로 아동의 성격을 장점과 단점으로 나눠서 분석해줘. 분석이 끝나면 단점에 대한 해결 방안을 제시해줘
          `,
      });

      // AI 분석
      const response = await openai.chat.completions.create({
        messages: [...analysisPrompt, ...userPrompt],
        model: "gpt-4o", // gpt-4-turbo, gpt-4-1106-preview, gpt-3.5-turbo-1106, gpt-3.5-turbo-instruct(Regercy), ft:gpt-3.5-turbo-1106:personal::8fIksWK3
        temperature: 1,
      });

      const message = { message: response.choices[0].message.content };

      // client 전송
      res.json({ message: mailOptions.text });

      /* PT Data DB 저장 */
      const pt_table = PT_Table_Info["Main"].table;
      const pt_attribute = PT_Table_Info["Main"].attribute;

      // 오늘 날짜 변환
      const dateObj = new Date();
      const year = dateObj.getFullYear();
      const month = ("0" + (dateObj.getMonth() + 1)).slice(-2);
      const day = ("0" + dateObj.getDate()).slice(-2);
      const date = `${year}-${month}-${day}`;

      // soyes_ai_Pt Table 삽입
      // 1. SELECT TEST (row가 있는지 없는지 검사)
      const select_query = `SELECT * FROM ${pt_table} WHERE ${pt_attribute.pKey}='${parsepUid}'`;
      const pt_data = await fetchUserData(connection_AI, select_query);

      // 2. UPDATE TEST (row값이 있는 경우 실행)
      if (pt_data[0]) {
        const update_query = `UPDATE ${pt_table} SET ${Object.values(
          pt_attribute
        )
          .filter((el) => el !== "uid")
          .map((el) => {
            return `${el} = ?`;
          })
          .join(", ")} WHERE ${pt_attribute.pKey} = ?`;
        // console.log(update_query);

        const update_value = [
          date,
          parsePTResult,
          JSON.stringify({ ...mailOptions, date }),
          parsepUid,
        ];

        // console.log(update_value);

        connection_AI.query(
          update_query,
          update_value,
          (error, rows, fields) => {
            if (error) console.log(error);
            else console.log("PT TEST Analysis Data DB UPDATE Success!");
          }
        );
      }
      // 3. INSERT TEST (row값이 없는 경우 실행)
      else {
        const pt_insert_query = `INSERT INTO ${pt_table} (${Object.values(
          pt_attribute
        ).join(", ")}) VALUES (${Object.values(pt_attribute)
          .map((el) => "?")
          .join(", ")})`;
        // console.log(insert_query);

        const pt_insert_value = [
          parsepUid,
          date,
          resultText,
          JSON.stringify({ ...mailOptions, date }),
        ];

        connection_AI.query(
          pt_insert_query,
          pt_insert_value,
          (error, rows, fields) => {
            if (error) console.log(error);
            else console.log("PT TEST Analysis Data DB INSERT Success!");
          }
        );
      }

      /* PT_Log DB 저장 */
      const pt_log_table = PT_Table_Info["Log"].table;
      const pt_log_attribute = PT_Table_Info["Log"].attribute;
      // PT_Log DB 저장
      const pt_insert_query = `INSERT INTO ${pt_log_table} (${Object.values(
        pt_log_attribute
      ).join(", ")}) VALUES (${Object.values(pt_attribute)
        .map((el) => "?")
        .join(", ")})`;
      // console.log(insert_query);

      const pt_insert_value = [
        parsepUid,
        date,
        resultText,
        JSON.stringify({ ...mailOptions, date }),
      ];
      // console.log(insert_value);

      connection_AI.query(pt_insert_query, pt_insert_value, (err) => {
        if (err) {
          console.log("PT Analysis Data DB Save Fail!");
          console.log("Err sqlMessage: " + err.sqlMessage);
        } else console.log("AI Analysis Data LOG DB INSERT Success!");
      });
    } catch (err) {
      console.log(err);
      res.json({ message: "Server Error - 500 Bad Gateway" });
    }
  },
  // PT 결과 저장 API (GPT 분석 없이 성격검사 결과를 저장만 하는 API)
  postOpenAIPernalTestSave: async (req, res) => {
    const { data } = req.body; // 클라이언트 한계로 데이터 묶음으로 받기.

    let parseData;
    try {
      // 파싱. Client JSON 데이터
      if (typeof data === "string") {
        parseData = JSON.parse(data);
      } else parseData = data;

      const { resultText, pUid } = parseData;
      console.log(`PT 테스트 결과 저장 API 호출 - pUid: ${pUid}`);
      console.log(parseData);

      // No type => return
      if (!resultText) {
        console.log("No resultText input value - 404");
        return res
          .status(404)
          .json({ message: "No resultText input value - 404" });
      }
      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 404");
        return res.status(404).json({ message: "No pUid input value - 404" });
      }

      parsepUid = pUid;

      // 오늘 날짜 변환
      const dateObj = new Date();
      const year = dateObj.getFullYear();
      const month = ("0" + (dateObj.getMonth() + 1)).slice(-2);
      const day = ("0" + dateObj.getDate()).slice(-2);
      const date = `${year}-${month}-${day}`;

      /* PT_Log DB 저장 */
      const pt_log_table = PT_Table_Info["Log"].table;

      const pt_insert_query = `INSERT INTO ${pt_log_table}
      (uid, date, persanl_result)
      VALUES (?, ?, ?)`;

      const pt_insert_value = [parsepUid, date, resultText];
      // console.log(insert_value);

      connection_AI.query(pt_insert_query, pt_insert_value, (err) => {
        if (err) {
          console.log("PT Analysis Data DB Save Fail!");
          console.log("Err sqlMessage: " + err.sqlMessage);
        }
        console.log("AI Analysis Data LOG DB INSERT Success!");
        // client 전송
        return res
          .status(200)
          .json({ message: "AI Analysis Data LOG DB INSERT Success!" });
      });
    } catch (err) {
      delete err.headers;
      console.error(err);
      return res.status(500).json({
        message: `Server Error : ${err.message}`,
      });
    }
  },
  // 공감친구 모델 - 푸푸
  postOpenAIConsultingPupu: async (req, res) => {
    const { EBTData } = req.body;

    // console.log("req.sessionID: " + req.sessionID);

    let parseEBTdata, parseMessageArr, parsepUid; // Parsing 변수
    let promptArr = [],
      userPrompt = []; // 삽입 Prompt Array
    // let prevChat_flag = true; // 이전 대화 내역 유무
    // console.log(`accessAuth: ${req.session.accessAuth}`);

    try {
      if (typeof EBTData === "string") {
        parseEBTdata = JSON.parse(EBTData);
      } else parseEBTdata = EBTData;

      const { messageArr, pUid } = parseEBTdata;

      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.json({ message: "No pUid input value - 400" });
      }
      // No type => return
      // if (!type) {
      //   console.log("No type input value - 400");
      //   return res.json({ message: "No type input value - 400" });
      // }
      // No messageArr => return
      if (!messageArr) {
        console.log("No messageArr input value - 400");
        return res.json({ message: "No messageArr input value - 400" });
      }

      // messageArr가 문자열일 경우 json 파싱
      if (typeof messageArr === "string") {
        parseMessageArr = JSON.parse(messageArr);
      } else parseMessageArr = [...messageArr];

      // pUid default값 설정
      parsepUid = pUid;
      console.log(
        `푸푸 상담 API /consulting_emotion_pupu Path 호출 - pUid: ${parsepUid}`
      );

      // 고정 삽입 프롬프트
      promptArr.push(persona_prompt_pupu_v5); // 2024.08.21~
      promptArr.push(info_prompt); // 유저관련 정보

      // const lastUserContent =
      //   parseMessageArr[parseMessageArr.length - 1].content; // 유저 마지막 멘트

      // // 대화 6회 미만 - 심리 상담 프롬프트 삽입
      // if (parseMessageArr.length < 11) {
      //   console.log("심리 상담 프롬프트 삽입");
      //   promptArr.push(EBT_Table_Info[type].consult);
      // }
      // // 대화 6회 - 심리 상담 프롬프트 + 심리 상태 분석 프롬프트 삽입
      // else if (parseMessageArr.length === 11) {
      //   console.log("심리 상담 프롬프트 + 심리 요약 프롬프트 삽입");
      //   promptArr.push(EBT_Table_Info[type].consult);
      //   // 비교 분석용 EBT class 맵
      //   const compareTypeMap = {
      //     School: ["School", "Attention"], // 학업/성적 상담은 School, Attention 분석과 비교하여 해석.
      //     Friend: ["Friend", "Movement"],
      //     Family: ["Family"],
      //     Mood: ["Mood", "Unrest", "Sad", "Angry"],
      //     Health: ["Health"],
      //     Self: ["Self"],
      //   };

      //   let resolvedCompareEbtAnalysis; // EBT 분석을 담을 배열
      //   // compareTypeMap에 맵핑되는 분야의 검사 결과를 DB에서 조회
      //   const compareEbtAnalysis = await compareTypeMap[type].map(
      //     async (ebtClass) => {
      //       return await select_soyes_AI_Ebt_Analyis(
      //         EBT_Table_Info[ebtClass],
      //         parsepUid
      //       );
      //     }
      //   );
      //   // Promise Pending 대기
      //   await Promise.all(compareEbtAnalysis).then((data) => {
      //     resolvedCompareEbtAnalysis = [...data]; // resolve 상태로 반환된 prompt 배열을 psy_testResult_promptArr_last 변수에 복사
      //   });
      //   // userPrompt 명령 추가
      //   userPrompt.push({
      //     role: "user",
      //     content: `아래는 user의 정서행동검사 결과야.
      //     '''
      //     ${resolvedCompareEbtAnalysis.map((data) => {
      //       const { ebtClass, analyisResult } = data;
      //       return `
      //       ${ebtClass}: { ${
      //         analyisResult === "NonTesting"
      //           ? `'정서행동검사 - ${analyisResult}'을 실시하지 않았습니다.`
      //           : analyisResult
      //       }}
      //       `;
      //     })}
      //     '''
      //     지금까지 대화를 기반으로 user의 심리 상태를 3문장으로 요약하고, 위 정서행동검사 결과와 비교하여 2문장으로 해석해줘.
      //       `,
      //   });
      // } else {
      //   console.log(
      //     `심리 솔루션 프롬프트 삽입 - solution:${req.session.solution?.solutionClass}`
      //   );
      //   promptArr.push(EBT_Table_Info[type].solution);
      // }

      // 상시 삽입 프롬프트
      // promptArr.push(completions_emotion_prompt); // 답변 이모션 넘버 확인 프롬프트 삽입

      // console.log(promptArr);

      const response = await openai.chat.completions.create({
        messages: [...promptArr, ...parseMessageArr, ...userPrompt],
        model: "gpt-4o", // gpt-4-turbo, gpt-4-0125-preview, gpt-3.5-turbo-0125, ft:gpt-3.5-turbo-1106:personal::8fIksWK3
      });

      // let emotion = parseInt(response.choices[0].message.content.slice(-1));
      // console.log("emotion: " + emotion);

      const message = {
        message: response.choices[0].message.content,
        emotion: 0,
      };
      // 대화 내역 로그
      // console.log([
      //   ...parseMessageArr,
      //   { role: "assistant", content: response.choices[0].message.content },
      //   // response.choices[0].message.content,
      // ]);

      // 심리 분석 DB 저장
      // if (parseMessageArr.length === 11) {
      //   const table = Consult_Table_Info["Analysis"].table;
      //   const attribute = Consult_Table_Info["Analysis"].attribute;

      //   // DB에 Row가 없을 경우 INSERT, 있으면 지정한 속성만 UPDATE
      //   const duple_query = `INSERT INTO ${table} (${attribute.pKey}, ${attribute.attr1}) VALUES (?, ?) ON DUPLICATE KEY UPDATE
      //     ${attribute.attr1} = VALUES(${attribute.attr1});`;

      //   const duple_value = [parsepUid, JSON.stringify(message)];

      //   connection_AI.query(duple_query, duple_value, (error, rows, fields) => {
      //     if (error) console.log(error);
      //     else console.log("Ella Consult Analysis UPDATE Success!");
      //   });

      //   // 엘라 유저 분석 내용 Session 저장
      //   req.session.ella_analysis = message.message;
      // }

      return res.status(200).json(message);
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        message: "Server Error - 500 Bad Gateway" + err.message,
        emotion: 0,
      });
    }

    // try {
    //   /* 비인증 || 세션 만료 유저 접근 처리
    //   if (!req.session.accessToken) {
    //     console.log("Unauthorized User Accessed");
    //     return res
    //       .status(401)
    //       .json({ message: "Session Expiration" });
    //   }
    //   */
    //   if (typeof EBTData === "string") {
    //     parseEBTdata = JSON.parse(EBTData);
    //   } else parseEBTdata = EBTData;

    //   const { messageArr, pUid } = parseEBTdata;
    //   // messageArr가 문자열일 경우 json 파싱
    //   if (typeof messageArr === "string") {
    //     parseMessageArr = JSON.parse(messageArr);
    //   } else parseMessageArr = [...messageArr];

    //   // No pUid => return
    //   if (!pUid) {
    //     console.log("No pUid input value - 400");
    //     return res.json({ message: "No pUid input value - 400" });
    //   }

    //   parsepUid = pUid;
    //   console.log(
    //     `푸푸 상담 API /consulting_emotion_pupu Path 호출 - pUid: ${parsepUid}`
    //   );

    //   // 고정 삽입 프롬프트
    //   promptArr.push(persona_prompt_pupu_v2); // 페르소나 프롬프트 삽입
    //   promptArr.push(info_prompt); // 유저 정보 프롬프트 삽입

    //   const lastUserContent =
    //     parseMessageArr[parseMessageArr.length - 1].content; // 유저 마지막 멘트

    //   // NO REQ 질문 처리. 10초 이상 질문이 없을 경우 Client 측에서 'NO REQUEST' 메시지를 담은 요청을 보냄. 그에 대한 처리
    //   if (lastUserContent.includes("NO REQ")) {
    //     console.log("NO REQUEST 전달");

    //     parseMessageArr.push(no_req_prompt);
    //     promptArr.push(sentence_division_prompt);

    //     const response = await openai.chat.completions.create({
    //       messages: [...promptArr, ...parseMessageArr],
    //       model: "gpt-4-0125-preview", // gpt-4-0125-preview, gpt-3.5-turbo-0125, ft:gpt-3.5-turbo-1106:personal::8fIksWK3
    //     });

    //     res.json({
    //       message: response.choices[0].message.content,
    //       emotion: 0,
    //     });

    //     return;
    //   }

    //   // // 유저 성격검사 결과 DB에서 가져오기
    //   // const pt_result = await select_soyes_AI_Pt_Table(
    //   //   PT_Table_Info["Main"].table,
    //   //   PT_Table_Info["Main"].attribute,
    //   //   parsepUid
    //   // );
    //   // console.log(`성격검사 결과: ${pt_result}`);
    //   // // promptArr.push(persnal_result_prompt[pt_result]);
    //   // promptArr.push({
    //   //   role: "system",
    //   //   content: `다음 문단은 'user'의 성격검사 결과입니다.
    //   //   '''
    //   //   ${
    //   //     pt_result !== "default"
    //   //       ? `'user'는 성격검사 결과 ${pt_result} 유형에 해당됩니다. ${pt_result} 유형은 ${persnal_short["IFPE"]}`
    //   //       : "user는 성격검사를 진행하지 않았습니다."
    //   //   }
    //   //   '''
    //   //   'assistant'는 'user'의 성격 유형을 알고있습니다.
    //   //   `,
    //   // });

    //   // if (parseMessageArr.length === 1 && prevChat_flag) {
    //   //   // 이전 대화 프롬프트 삽입
    //   //   console.log("이전 대화 프롬프트 삽입");
    //   //   promptArr.push(prevChat_prompt);
    //   // }

    //   // if (parseMessageArr.length) {
    //   //   // 심리 검사 프롬프트 삽입
    //   //   console.log("심리 검사 프롬프트 삽입");
    //   //   promptArr.push(psy_testResult_prompt);
    //   //   promptArr.push(psyResult_prompt);
    //   //   promptArr.push(solution_prompt);
    //   // }

    //   // if (parseMessageArr.length === 17 || parseMessageArr.length === 19) {
    //   //   // 솔루션 프롬프트 삽입
    //   //   console.log("솔루션 프롬프트 삽입");
    //   //   promptArr.push(solution_prompt);
    //   // }

    //   // 상시 삽입 프롬프트

    //   // promptArr.push(solution_prompt2); // 음악 명상 + 그림 명상 관련 솔루션 프롬프트
    //   // promptArr.push(common_prompt); // 공통 프롬프트 삽입
    //   // promptArr.push(completions_emotion_prompt); // 답변 이모션 넘버 확인 프롬프트 삽입

    //   // console.log(promptArr);

    //   /* Regercy
    //   // 심리팀 Test Prompt. {role: user} 상태로 삽입
    //   parseMessageArr.unshift(test_prompt_20240402);

    //   const response = await openai.chat.completions.create({
    //     messages: [...promptArr, ...parseMessageArr],
    //     model: "gpt-4-0125-preview", // gpt-4-0125-preview, gpt-3.5-turbo-0125, ft:gpt-3.5-turbo-1106:personal::8fIksWK3
    //   });

    //   let emotion = "0";
    //   const message = {
    //     message: response.choices[0].message.content,
    //     emotion,
    //   };
    //   */

    //   const response = await openai.chat.completions.create({
    //     messages: [...promptArr, ...parseMessageArr],
    //     model: "ft:gpt-3.5-turbo-1106:personal::9dYars0I", // gpt-4o, gpt-4-turbo, gpt-4-0125-preview, gpt-3.5-turbo-0125, ft:gpt-3.5-turbo-1106:personal::8fIksWK3
    //   });

    //   // let emotion = parseInt(response.choices[0].message.content.slice(-1));

    //   const message = {
    //     message: response.choices[0].message.content,
    //     emotion: 1,
    //   };

    //   // Log 출력
    //   // console.log([
    //   //   ...parseMessageArr,
    //   //   { role: "assistant", content: message.message },
    //   // ]);

    //   // Client 반환
    //   res.status(200).json(message);
    // } catch (err) {
    //   console.error(err);
    //   res.json({
    //     message: "Server Error",
    //     emotion: 0,
    //   });
    // }
  },
  // 게임친구 모델 - 우비
  postOpenAIConsultingUbi: async (req, res) => {
    const { EBTData } = req.body;
    console.log(EBTData);

    let parseEBTdata, parseMessageArr, parsepUid; // Parsing 변수
    let promptArr = []; // 삽입 Prompt Array
    // let prevChat_flag = true; // 이전 대화 내역 유무
    // console.log(messageArr);
    try {
      if (typeof EBTData === "string") {
        parseEBTdata = JSON.parse(EBTData);
      } else parseEBTdata = EBTData;

      const { messageArr, pUid, game } = parseEBTdata;
      // messageArr가 문자열일 경우 json 파싱
      if (typeof messageArr === "string") {
        parseMessageArr = JSON.parse(messageArr);
      } else parseMessageArr = [...messageArr];

      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.json({ message: "No pUid input value - 400" });
      }

      if (!game) {
        console.log("No game input value - 400");
        return res.json({ message: "No game input value - 400" });
      }

      parsepUid = pUid;
      console.log(
        `우비 상담 API /consulting_emotion_ubi Path 호출 - pUid: ${parsepUid}`
      );
      // 고정 삽입 프롬프트
      promptArr.push(persona_prompt_ubi); // 페르소나 프롬프트 삽입
      promptArr.push(info_prompt); // 유저 정보 프롬프트 삽입

      // const lastUserContent =
      //   parseMessageArr[parseMessageArr.length - 1].content; // 유저 마지막 멘트

      // NO REQ 질문 처리. 10초 이상 질문이 없을 경우 Client 측에서 'NO REQUEST' 메시지를 담은 요청을 보냄. 그에 대한 처리
      // if (lastUserContent.includes("NO REQ")) {
      //   console.log("NO REQUEST 전달");

      //   parseMessageArr.push(no_req_prompt);
      //   promptArr.push(sentence_division_prompt);

      //   const response = await openai.chat.completions.create({
      //     messages: [...promptArr, ...parseMessageArr],
      //     model: "gpt-4o", // gpt-4-0125-preview, gpt-3.5-turbo-0125, ft:gpt-3.5-turbo-1106:personal::8fIksWK3
      //   });

      //   res.json({
      //     message: response.choices[0].message.content,
      //     emotion: 0,
      //   });

      //   return;
      // }

      // 유저 성격검사 결과 DB에서 가져오기
      // const pt_result = await select_soyes_AI_Pt_Table(
      //   PT_Table_Info["Main"].table,
      //   PT_Table_Info["Main"].attribute,
      //   parsepUid
      // );
      // // console.log(pt_result);
      // promptArr.push({
      //   role: "system",
      //   content: `다음 문단은 'user'의 성격검사 결과입니다.
      //   '''
      //   ${
      //     pt_result !== "default"
      //       ? `'user'는 성격검사 결과 ${pt_result} 유형에 해당됩니다. ${pt_result} 유형은 ${persnal_short["IFPE"]}`
      //       : "user는 성격검사를 진행하지 않았습니다."
      //   }
      //   '''
      //   'assistant'는 'user'의 성격 유형을 알고있습니다.
      //   `,
      // });

      // 상시 삽입 프롬프트
      // promptArr.push(solution_prompt); // 학습 관련 솔루션 프롬프트
      // promptArr.push(sentence_division_prompt); // 공통 프롬프트 삽입
      // promptArr.push(completions_emotion_prompt); // 답변 이모션 넘버 확인 프롬프트 삽입

      // console.log(promptArr);

      if (game === "remarks") {
        promptArr.push({
          role: "system",
          content: `assistant는 user와 끝말잇기 게임을 진행한다. 단어는 2 ~ 5글자 사이의 명사만으로 생성한다. 
'륨', '릇'과 같은 한방단어로 인해 assistant가 패배할 경우 assistant는 패배를 인정하고 재시작 여부를 user에게 묻는다.`,
        });
      }

      const response = await openai.chat.completions.create({
        messages: [...promptArr, ...parseMessageArr],
        model: "gpt-4o", // gpt-4-0125-preview, gpt-3.5-turbo-0125, ft:gpt-3.5-turbo-1106:personal::8fIksWK3
      });

      // let emotion = parseInt(response.choices[0].message.content.slice(-1));
      // console.log(emotion);

      const message = {
        message: response.choices[0].message.content,
        // emotion,
      };
      // console.log([
      //   ...parseMessageArr,
      //   { role: "assistant", content: message.message },
      // ]);
      res.json(message);
    } catch (err) {
      console.error(err);
      res.json({
        message: "Server Error",
        // emotion: 0,
      });
    }
  },
  // 전문상담사 모델 - 소예
  postOpenAIConsultingSoyes: async (req, res) => {
    const { EBTData } = req.body;
    // console.log(EBTData);
    let parseEBTdata, parseMessageArr, parsepUid; // Parsing 변수
    let promptArr = []; // 삽입 Prompt Array
    // let prevChat_flag = true; // 이전 대화 내역 유무

    // 응답에 헤더를 추가하는 메서드
    // res.header("Test_Header", "Success Header");

    try {
      if (typeof EBTData === "string") {
        parseEBTdata = JSON.parse(EBTData);
      } else parseEBTdata = EBTData;

      const { messageArr, pUid } = parseEBTdata;
      // messageArr가 문자열일 경우 json 파싱
      if (typeof messageArr === "string") {
        parseMessageArr = JSON.parse(messageArr);
      } else parseMessageArr = [...messageArr];

      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.json({ message: "No pUid input value - 400" });
      }

      parsepUid = pUid;
      console.log(
        `소예 상담 API /consulting_emotion_soyes Path 호출 - pUid: ${parsepUid}`
      );
      // 고정 삽입 프롬프트
      promptArr.push(persona_prompt_soyes); // 페르소나 프롬프트 삽입
      promptArr.push(info_prompt); // 유저 정보 프롬프트 삽입

      const lastUserContent =
        parseMessageArr[parseMessageArr.length - 1].content; // 유저 마지막 멘트

      // NO REQ 질문 처리. 10초 이상 질문이 없을 경우 Client 측에서 'NO REQUEST' 메시지를 담은 요청을 보냄. 그에 대한 처리
      if (lastUserContent.includes("NO REQ")) {
        console.log("NO REQUEST 전달");
        parseMessageArr.pop(); // 'NO REQUEST 질문 삭제'
        parseMessageArr.push(no_req_prompt);
        promptArr.push(sentence_division_prompt);

        const response = await openai.chat.completions.create({
          messages: [...promptArr, ...parseMessageArr],
          model: "gpt-4-0125-preview", // gpt-4-0125-preview, gpt-3.5-turbo-0125, ft:gpt-3.5-turbo-1106:personal::8fIksWK3
        });

        res.json({
          message: response.choices[0].message.content,
          emotion: 0,
        });

        return;
      }

      /* 프롬프트 삽입 분기 */

      //     // 심리 검사 결과 프롬프트 상시 삽입
      //     if (!req.session.psy_testResult_promptArr_last) {
      //       // 심리 검사 결과 프롬프트 삽입
      //       console.log("심리 검사 결과 프롬프트 삽입");
      //       let psy_testResult_promptArr_last = []; // 2점을 획득한 정서행동검사 문항을 저장하는 prompt
      //       // TODO# EBT Table 갱신 후 변경 예정
      //       const psy_testResult_promptArr = EBT_classArr.map(async (ebt_class) => {
      //         const select_Ebt_Result = await select_soyes_AI_Ebt_Table(
      //           EBT_Table_Info[ebt_class].table, // Table Name
      //           EBT_Table_Info[ebt_class].attribute,
      //           EBT_Table_Info[ebt_class].result, // EBT Question 11가지 분야 중 1개 (Table에 따라 결정)
      //           parsepUid // Uid
      //         );

      //         // console.log(select_Ebt_Result);

      //         const psy_testResult_prompt = {
      //           role: "system",
      //           content: `다음에 오는 문단은 user의 ${ebt_class} 관련 심리검사 결과입니다.
      // '''
      // ${select_Ebt_Result.testResult}
      // '''
      // 위 문단이 비어있다면 ${
      //   // DB Table의 값 유무에 따라 다른 프롬프트 입력
      //   !select_Ebt_Result.ebt_school_data[0]
      //     ? "user는 심리검사를 진행하지 않았습니다."
      //     : "user의 심리검사 결과는 문제가 없습니다."
      // }`,
      //         };
      //         // console.log(psy_testResult_prompt);
      //         return psy_testResult_prompt;
      //       });
      //       // map method는 pending 상태의 promise를 반환하므로 Promise.all method를 사용하여 resolve 상태가 되기를 기다려준다.
      //       await Promise.all(psy_testResult_promptArr).then((prompt) => {
      //         psy_testResult_promptArr_last = [...prompt]; // resolve 상태로 반환된 prompt 배열을 psy_testResult_promptArr_last 변수에 복사
      //       });

      //       // console.log(psy_testResult_promptArr_last);

      //       promptArr.push(...psy_testResult_promptArr_last);
      //       promptArr.push(psyResult_prompt);
      //       // promptArr.push(solution_prompt);

      //       req.session.psy_testResult_promptArr_last = [
      //         ...psy_testResult_promptArr_last,
      //       ];
      //     } else {
      //       console.log("세션 저장된 심리 검사 결과 프롬프트 삽입");
      //       promptArr.push(...req.session.psy_testResult_promptArr_last);
      //       promptArr.push(psyResult_prompt);
      //     }

      // 검사 결과 분석 관련 멘트 감지
      let testClass = ""; // 감지 텍스트 저장 변수
      if (
        !req.session.ebt_class &&
        test_result_ment.some((el) => {
          if (lastUserContent.includes(el.text)) {
            testClass = el.class;
            return true;
          } else return false;
        })
      ) {
        console.log(`정서행동검사 결과 - ${testClass} 분석 프롬프트 삽입`);
        // 감지된 분야 선택
        // const random_class = EBT_classArr[class_map[testClass]];
        const random_class = testClass;

        // 심리 결과 분석 프롬프트
        parseMessageArr.push({
          role: "user",
          content: `마지막 질문에 대해 1문장 이내로 답변한 뒤 (이해하지 못했으면 답변하지마), 
          '너의 심리검사 결과를 봤어!'라고 언급하면서 ${random_class} 관련 심리검사 결과를 분석한 아동의 심리 상태를 5문장 이내로 설명해줘.
          만약 심리 검사 결과를 진행하지 않았다면, 잘 모르겠다고 답변해줘.
          . 혹은 ? 같은 특수문자로 끝나는 각 마디 뒤에는 반드시 줄바꿈(\n)을 추가해줘.
          검사 결과가 있다면 답변 마지막에는 '검사 결과에 대해 더 궁금한점이 있니?'를 추가해줘.`,
        });
        promptArr.push({
          role: "system",
          content: `이번 문답은 예외적으로 6문장 이내로 답변을 생성합니다.`,
        });
      }
      // 아무런 분기도 걸리지 않을 경우
      else promptArr.push(sentence_division_prompt);

      /*
      // 답변 횟수 카운트
      if (!req.session.answerCnt || parseMessageArr.length === 1)
        req.session.answerCnt = 1;
      else if (req.session.answerCnt > 9) {
        // 답변 10회 이상 진행 시 세션 파괴
        req.session.destroy();
        res.clearCookie("connect.sid");
      } else req.session.answerCnt++;
      */

      // 상시 삽입 프롬프트
      // promptArr.push(sentence_division_prompt); // 문장 구분 프롬프트 삽입
      promptArr.push(completions_emotion_prompt); // 답변 이모션 넘버 확인 프롬프트 삽입

      // console.log(promptArr);

      const response = await openai.chat.completions.create({
        messages: [...promptArr, ...parseMessageArr],
        model: "gpt-4o", // gpt-4-0125-preview, gpt-3.5-turbo-0125, ft:gpt-3.5-turbo-1106:personal::8fIksWK3
      });

      let emotion = parseInt(response.choices[0].message.content.slice(-1));
      console.log("emotion: " + emotion);

      const message = {
        message: response.choices[0].message.content.slice(0, -1),
        emotion,
      };
      // console.log([
      //   ...parseMessageArr,
      //   { role: "assistant", content: message.message },
      // ]);

      // 세션 확인 코드
      // console.log(req.session);

      res.json(message);
    } catch (err) {
      console.error(err);
      res.json({
        message: "Server Error",
        emotion: 0,
      });
    }
  },
  // 달력 관련 데이터 반환 (Date 단위)
  postOpenAIMypageCalendarData: async (req, res) => {
    const { EBTData } = req.body;
    let parseEBTdata, parsepUid, parseDate; // Parsing 변수
    console.log(EBTData);
    try {
      // json 파싱
      if (typeof EBTData === "string") {
        parseEBTdata = JSON.parse(EBTData);
      } else parseEBTdata = EBTData;

      const { pUid, date } = parseEBTdata;
      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.json({ message: "No pUid input value - 400" });
      }
      // pUid default값 설정
      parsepUid = pUid;
      parseDate = date;

      console.log(
        `달력 데이터 반환 API /openAI/calendar Path 호출 - pUid: ${parsepUid}`
      );

      // DB 조회 => User Table + User EBT Table JOIN 후 관련 데이터 전달
      const user_table = User_Table_Info.table;

      // TODO# EBT Table 갱신 후 변경 예정
      const ebt_log_table = EBT_Table_Info["Log"].table;
      const ebt_log_attribute = EBT_Table_Info["Log"].attribute;

      const pt_log_table = PT_Table_Info["Log"].table;
      const pt_log_attribute = PT_Table_Info["Log"].attribute;
      const consult_log_table = Consult_Table_Info["Log"].table;
      const consult_log_attribute = Consult_Table_Info["Log"].attribute;

      // 1. SELECT USER JOIN EBT_Log
      const select_ebt_join_query = `SELECT
      ${ebt_log_table}.${ebt_log_attribute.attr2},
      ${ebt_log_table}.${ebt_log_attribute.attr3}
      FROM ${ebt_log_table}
      WHERE uid = '${parsepUid}'
      AND created_at LIKE '${parseDate}%'
      ORDER BY created_at DESC;`;

      const ebt_join_data = await fetchUserData(
        connection_AI,
        select_ebt_join_query
      );
      // console.log(ebt_join_data);

      // 2. SELECT USER PT_Log
      const select_pt_join_query = `SELECT
      ${pt_log_table}.${pt_log_attribute.attr2},
      ${pt_log_table}.${pt_log_attribute.attr3}
      FROM ${pt_log_table}
      WHERE uid = '${parsepUid}'
      AND created_at LIKE '${parseDate}%'
      ORDER BY created_at DESC;`;

      const pt_join_data = await fetchUserData(
        connection_AI,
        select_pt_join_query
      );

      // 3. SELECT USER Consult_Log
      const select_consult_join_query = `SELECT
      ${consult_log_table}.${consult_log_attribute.attr1},
      ${consult_log_table}.${consult_log_attribute.attr2}
      FROM ${consult_log_table}
      WHERE uid = '${parsepUid}'
      AND created_at LIKE '${parseDate}%'
      ORDER BY created_at DESC;`;

      const consult_join_data = await fetchUserData(
        connection_AI,
        select_consult_join_query
      );

      // 프론트 데이터값 참조
      // const userInfoArr = [
      //   {
      //     title: '성격검사',
      //     type: 'pt_data',
      //     iconSrc: '/src/Content_IMG/Icon_IMG/Icon_요가명상.png',
      //     playIconSrc: '/src/Content_IMG/Frame_재생버튼.png',
      //   },
      //   {
      //     title: '정서행동검사',
      //     type: 'ebt_data',
      //     iconSrc: '/src/Content_IMG/Icon_IMG/Icon_요가명상.png',
      //     playIconSrc: '/src/Content_IMG/Frame_재생버튼.png',
      //   },
      //   {
      //     title: '심리상담',
      //     type: 'consult_data',
      //     iconSrc: '/src/Content_IMG/Icon_IMG/Icon_요가명상.png',
      //     playIconSrc: '/src/Content_IMG/Frame_재생버튼.png',
      //   },
      //   {
      //     title: '콘텐츠',
      //     type: 'content_data',
      //     iconSrc: '/src/Content_IMG/Icon_IMG/Icon_요가명상.png',
      //     playIconSrc: '/src/Content_IMG/Frame_재생버튼.png',
      //   },
      //   {
      //     title: '엘라상담',
      //     type: 'ella_data',
      //     iconSrc: '/src/Content_IMG/Icon_IMG/Icon_요가명상.png',
      //     playIconSrc: '/src/Content_IMG/Frame_재생버튼.png',
      //   },
      //   {
      //     title: '명상',
      //     type: 'meditation_data',
      //     iconSrc: '/src/Content_IMG/Icon_IMG/Icon_요가명상.png',
      //     playIconSrc: '/src/Content_IMG/Frame_재생버튼.png',
      //   },
      // ];

      return res.json({
        ebt_data: ebt_join_data.map((el) => {
          return { ...el, ebt_analysis: JSON.parse(el.ebt_analysis).text };
        }),
        pt_data: pt_join_data.map((el) => {
          return { ...el, pt_analysis: "" };
        }),
        // 값을 파싱해서 사용해야함!
        consult_data: consult_join_data.map((el) => {
          return { ...el };
        }),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        message: "Server Error - 500",
      });
    }
  },
  // 마이페이지 데이터 반환 API
  postOpenAIMypageData: async (req, res) => {
    const { EBTData } = req.body;
    let parseEBTdata, parsepUid; // Parsing 변수

    try {
      // json 파싱
      if (typeof EBTData === "string") {
        parseEBTdata = JSON.parse(EBTData);
      } else parseEBTdata = EBTData;

      const { pUid } = parseEBTdata;
      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.json({ message: "No pUid input value - 400" });
      }
      // pUid default값 설정
      parsepUid = pUid;
      // parseDate = date;

      console.log(
        `마이페이지 데이터 반환 API /openAI/mypage Path 호출 - pUid: ${parsepUid}`
      );

      // EBT Table Key
      const ebt_log_table = EBT_Table_Info["All"].table;
      const ebt_log_attribute = EBT_Table_Info["All"].attribute;
      const { pKey, status, created_at, updated_at } = ebt_log_attribute;

      // PT Table Key
      const pt_log_table = PT_Table_Info["Log"].table;
      const pt_log_attribute = PT_Table_Info["Log"].attribute;

      // Consult Table Key
      // const consult_log_table = Consult_Table_Info["Log"].table;
      // const consult_log_attribute = Consult_Table_Info["Log"].attribute;

      // 1. SELECT USER JOIN EBT_Log
      const select_ebt_join_query = `SELECT ${pKey}, ${updated_at} FROM ${ebt_log_table} WHERE uid = '${parsepUid}' AND ${status} = '1' ORDER BY ${created_at} DESC LIMIT 5;`;

      const ebt_join_data = await fetchUserData(
        connection_AI,
        select_ebt_join_query
      );
      // console.log(ebt_join_data);

      // 2. SELECT USER PT_Log
      const select_pt_join_query = `SELECT ${pt_log_attribute.attr2}, created_at FROM ${pt_log_table} WHERE uid = '${parsepUid}' ORDER BY created_at DESC LIMIT 5;`;

      const pt_join_data = await fetchUserData(
        connection_AI,
        select_pt_join_query
      );

      // 3. SELECT USER Consult_Log
      // const select_consult_join_query = `SELECT ${consult_log_table}.${consult_log_attribute.attr1}, ${consult_log_table}.${consult_log_attribute.attr2} FROM ${consult_log_table} WHERE uid = '${parsepUid}' AND created_at LIKE '${parseDate}%' ORDER BY created_at DESC;`;

      // const consult_join_data = await fetchUserData(
      //   connection_AI,
      //   select_consult_join_query
      // );

      // 프론트 데이터값 참조
      // const userInfoArr = [
      //   {
      //     title: '성격검사',
      //     type: 'pt_data',
      //     iconSrc: '/src/Content_IMG/Icon_IMG/Icon_요가명상.png',
      //     playIconSrc: '/src/Content_IMG/Frame_재생버튼.png',
      //   },
      //   {
      //     title: '정서행동검사',
      //     type: 'ebt_data',
      //     iconSrc: '/src/Content_IMG/Icon_IMG/Icon_요가명상.png',
      //     playIconSrc: '/src/Content_IMG/Frame_재생버튼.png',
      //   },
      //   {
      //     title: '심리상담',
      //     type: 'consult_data',
      //     iconSrc: '/src/Content_IMG/Icon_IMG/Icon_요가명상.png',
      //     playIconSrc: '/src/Content_IMG/Frame_재생버튼.png',
      //   },
      //   {
      //     title: '콘텐츠',
      //     type: 'content_data',
      //     iconSrc: '/src/Content_IMG/Icon_IMG/Icon_요가명상.png',
      //     playIconSrc: '/src/Content_IMG/Frame_재생버튼.png',
      //   },
      //   {
      //     title: '엘라상담',
      //     type: 'ella_data',
      //     iconSrc: '/src/Content_IMG/Icon_IMG/Icon_요가명상.png',
      //     playIconSrc: '/src/Content_IMG/Frame_재생버튼.png',
      //   },
      //   {
      //     title: '명상',
      //     type: 'meditation_data',
      //     iconSrc: '/src/Content_IMG/Icon_IMG/Icon_요가명상.png',
      //     playIconSrc: '/src/Content_IMG/Frame_재생버튼.png',
      //   },
      // ];

      return res.status(200).json({
        message: "MyPage Data Access Success! - 200 OK",
        ebt_data: ebt_join_data.map((el) => {
          return {
            id: el.ebt_id,
            date: el.ebt_updated_at,
          };
        }),
        pt_data: pt_join_data.map((el) => {
          return {
            result: el.persanl_result,
            date: el.created_at,
          };
        }),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        message: "Server Error - 500",
      });
    }
  },
  // Clova Voice API 사용
  postClovaVoiceTTS: async (req, res) => {
    console.log("ClovaVoiceTTS API /openAI/tts Path 호출");
    const api_url = "https://naveropenapi.apigw.ntruss.com/tts-premium/v1/tts";

    const { data } = req.body;
    let parseData;
    try {
      if (typeof data === "string") {
        parseData = JSON.parse(data);
      } else parseData = data;

      const {
        speaker, // 필수
        text, // 필수
        volume,
        speed,
        pitch,
        emotion,
        alpha,
        format,
        emotionStrength,
        samplingRate,
        endPitch,
      } = parseData;

      console.log(parseData);

      const response = await axios.post(
        api_url,
        {
          speaker,
          volume,
          speed,
          pitch,
          text,
          emotion,
          alpha,
          format,
          "emotion-strength": emotionStrength,
          "sampling-rate": samplingRate,
          "end-pitch": endPitch,
        },
        {
          responseType: "arraybuffer", // Clova 음성 데이터를 arraybuffer로 받음
          headers: {
            "X-NCP-APIGW-API-KEY-ID": process.env.CLOVA_CLIENT_ID,
            "X-NCP-APIGW-API-KEY": process.env.CLOVA_CLIENT_SECRET,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      // console.log(response);
      // 음성 데이터를 클라이언트로 전송
      res.writeHead(200, {
        "Content-Type": "audio/mp3",
        "Content-Length": response.data.length,
      });

      // JSON 형식이 아니기에 res.json 사용 X
      res.end(response.data);
    } catch (error) {
      console.error(error);
      res.status(500).end("Internal Server Error");
    }
  },
  // 상담 로그 저장 API
  postOpenAIConsultingLogSave: async (req, res) => {
    const { EBTData } = req.body; // 클라이언트 한계로 데이터 묶음으로 받기.
    let parseEBTdata, parsepUid;
    try {
      // 파싱. Client JSON 데이터
      if (typeof EBTData === "string") {
        parseEBTdata = JSON.parse(EBTData);
      } else parseEBTdata = EBTData;

      const { messageArr, avarta, pUid } = parseEBTdata;
      // console.log(parseEBTdata);

      // No pUid => return
      if (!pUid) {
        console.log("Non pUid input value - 404");
        return res.status(404).json({ message: "Non pUid input value - 404" });
      }
      parsepUid = pUid;
      console.log(
        `상담 로그 저장 API /consulting_emotion_log Path 호출 - pUid: ${parsepUid}`
      );
      // 문답 5회 미만일 경우 return
      if (messageArr.length <= 8) {
        console.log(`messageArr Not enough length - pUid: ${parsepUid}`);
        return res
          .status(201)
          .json({ message: "messageArr Not enough length" });
      }

      /* Consult_Log DB 저장 */
      const consult_log_table = Consult_Table_Info["Log"].table;
      const consult_log_attribute = Consult_Table_Info["Log"].attribute;

      // Consult_Log DB 저장
      const consult_insert_query = `INSERT INTO ${consult_log_table} (${Object.values(
        consult_log_attribute
      ).join(", ")}) VALUES (${Object.values(consult_log_attribute)
        .map((el) => "?")
        .join(", ")})`;
      // console.log(consult_insert_query);

      const consult_insert_value = [
        parsepUid,
        avarta,
        JSON.stringify(messageArr),
      ];
      // console.log(consult_insert_value);

      connection_AI.query(consult_insert_query, consult_insert_value, (err) => {
        if (err) {
          console.log("Consulting_Log DB Save Fail!");
          console.log("Err sqlMessage: " + err.sqlMessage);
          res.json({ message: "Consulting_Log DB Save Fail!" });
        } else {
          console.log("Consulting_Log DB Save Success!");
          res.status(200).json({ message: "Consulting_Log DB Save Success!" });
        }
      });
    } catch (err) {
      console.log(err);
      res
        .status(500)
        .json({ message: "Consulting_Log DB Save Fail!" + err.message });
    }
  },
  // ClearCookies API
  getClearCookies: (req, res, next) => {
    console.log("ClearCookies API /openAI/clear_cookies Path 호출");
    try {
      res.clearCookie("connect.sid", { path: "/" });
      console.log("ClearCookies Success!");
      // res.json({
      //   data: "Clear Cookies Success!",
      // });
      next();
    } catch (err) {
      console.log(err);
      // res.json({
      //   data: "Clear Cookies Fail!",
      // });
    }
  },
  // 정서행동 검사 11종 결과 반환
  postOpenAIUserEBTResultData: async (req, res) => {
    const { EBTData } = req.body;
    let parseEBTdata, parsepUid;

    try {
      // json 파싱
      if (typeof EBTData === "string") {
        parseEBTdata = JSON.parse(EBTData);
      } else parseEBTdata = EBTData;

      const { pUid, contentKey, pKeyValue } = parseEBTdata;
      // contentKey: AI 분석 결과 반환 트리거
      // keyValue: EBT Table Row Primary Key. 마이페이지 결과보기 버튼에 할당 후 전달받을 예정

      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.status(400).json({ message: "No pUid input value - 400" });
      }
      // pUid default값 설정
      parsepUid = pUid;
      console.log(
        `User 정서행동 검사 결과 반환 API /openAI/ebtresult Path 호출 - pUid: ${parsepUid}`
      );

      // // TODO# New EBT Table 갱신 후 변경 예정
      // const ebtResultArr = EBT_classArr.map(async (ebt_class) => {
      //   const select_Ebt_Result = await select_soyes_AI_Ebt_Result(
      //     EBT_Table_Info[ebt_class],
      //     parsepUid // Uid
      //   );
      //   // contentKey 값이 입력되지 않을 경우 analysisResult 속성 삭제
      //   if (!contentKey) delete select_Ebt_Result.content;
      //   return { ebt_class, ...select_Ebt_Result };
      // });
      // // map method는 pending 상태의 promise를 반환하므로 Promise.all method를 사용하여 resolve 상태가 되기를 기다려준다.
      // await Promise.all(ebtResultArr).then((result) => {
      //   returnArr = [...result]; // resolve 상태로 반환된 배열을 returnArr 변수에 복사
      // });
      // // console.log(returnArr);

      const resultArr = await select_soyesAI_EbtResult_v2(
        pKeyValue,
        contentKey,
        parsepUid
      );

      // 정서행동검사 완료 데이터가 없을 경우
      if (!resultArr.length) {
        console.log(`Non ebt_data - pUid(${parsepUid})`);
        return res.status(200).json({
          message: [],
        });
      }

      // console.log(resultArr);

      return res.status(200).json({
        message: resultArr.sort((a, b) => b.tScore - a.tScore),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        message: "Server Error - 500",
      });
    }
  },
  // 성격 검사 결과 반환
  postOpenAIUserPTResultData: async (req, res) => {
    const { data } = req.body;
    let parseData, parsepUid;

    try {
      // json 파싱
      if (typeof data === "string") {
        parseData = JSON.parse(data);
      } else parseData = data;

      const { pUid } = parseData;

      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.status(400).json({ message: "No pUid input value - 400" });
      }
      // pUid default값 설정
      parsepUid = pUid;
      console.log(`성격 검사 결과 반환 API 호출 - pUid: ${parsepUid}`);

      const tableName = PT_Table_Info["Log"].table;

      const select_query = `SELECT
      persanl_result
      FROM ${tableName}
      WHERE uid = '${parsepUid}'
      ORDER BY created_at DESC
      LIMIT 1
      `;

      const ptResultData = await fetchUserData(connection_AI, select_query);

      // console.log(ptResultData);

      return res.status(200).json({
        data: ptResultData.length ? ptResultData[0].persanl_result : "",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        message: "Server Error - 500",
      });
    }
  },
  // getYoutubeContent API
  getYoutubeContent: async (req, res) => {
    // 영상 식별 번호 파라미터
    const videoId = req.params.id;
    try {
      // 식별 번호 없는 요청 처리
      if (!videoId) return res.status(404).send("Video Number not Input");
      // 영상 리스트 가져오기
      const response = await youtube.videos.list({
        id: videoId,
        part: "snippet,player",
      });
      // 영상 O
      if (response.data.items && response.data.items.length > 0) {
        const videoData = response.data.items[0];
        return res.status(200).json(videoData);
      }
      // 영상 X
      else {
        return res.status(404).send("Video not found");
      }
    } catch (error) {
      console.error("Error fetching video data:", error);
      res.status(500).send("Internal Server Error");
    }
  },
  // 상담 Solution 반환 API
  postOpenAIConsultSolutionData: async (req, res) => {
    const { EBTData } = req.body;
    let parseEBTdata, parseMessageArr, parsepUid, parseType;
    let promptArr = []; // 삽입 Prompt Array
    let userPrompt = []; // 삽입 User Prompt Array

    try {
      // json 파싱
      if (typeof EBTData === "string") {
        parseEBTdata = JSON.parse(EBTData);
      } else parseEBTdata = EBTData;

      const { pUid, messageArr, type, avarta } = parseEBTdata;
      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.status(400).json({ message: "No pUid input value - 400" });
      }

      if (!type) {
        console.log("No type input value - 400");
        return res.json({ message: "No type input value - 400" });
      }

      parsepUid = pUid;
      parseType = type;
      console.log(
        `User 상담 Solution 반환 API /openAI/solution Path 호출 - pUid: ${parsepUid}`
      );

      // messageArr가 문자열일 경우 json 파싱
      if (typeof messageArr === "string") {
        parseMessageArr = JSON.parse(messageArr);
      } else parseMessageArr = [...messageArr];

      // # TODO 솔루션 매칭
      promptArr.push(solution_matching_persona_prompt); // 솔루션 페르소나
      userPrompt.push({
        role: "user",
        content: `대화 내용을 기반으로 적절한 컨텐츠를 1단어로 추천해줘`,
      });

      const response = await openai.chat.completions.create({
        messages: [...promptArr, ...parseMessageArr, ...userPrompt],
        model: "gpt-4o", // gpt-4-turbo, gpt-4-0125-preview, gpt-3.5-turbo-0125, ft:gpt-3.5-turbo-1106:personal::8fIksWK3
      });

      /* 
      학업/성적: [cognitive, diary, meditation],
      대인관계: [cognitive, diary, balance, emotion, interpersonal],
      가족관계: [cognitive, diary, balance, interpersonal],
      기분/불안: [cognitive, diary, balance, meditation, emotion],
      신체 증상: [cognitive, diary, meditation, emotion],
      자기이해: [cognitive, diary],
      */

      const solution = response.choices[0].message.content;
      const message = {
        solution,
        solutionIndex: (Math.floor(Math.random() * 700) % 7) + 1, // default Index [1 ~ 7]
      };

      // #### 솔루션 임시 meditation 고정값 ####
      console.log(message.solutionIndex);
      message.solution = "meditation";

      //console.log(message);
      switch (message.solution) {
        case "meditation":
          req.session.solution = {
            solutionClass: "meditation",
            // prompt: cognitive_prompt[parseType],
          };
          break;
        case "cognitive":
          req.session.solution = {
            solutionClass: "cognitive",
            prompt: cognitive_prompt[parseType],
          };
          break;
        case "diary":
          req.session.solution = {
            solutionClass: "diary",
            prompt: diary_prompt,
          };
          break;
        case "balance":
          req.session.solution = {
            solutionClass: "balance",
            prompt: balance_prompt,
          };
          break;
        case "emotion":
          // req.session.solution = {
          //   solutionClass: "emotion",
          //   prompt: emotion_prompt,
          // };
          break;
        case "interpersonal":
          // req.session.solution = {
          //   solutionClass: "interpersonal",
          //   prompt: interpersonal_prompt,
          // };
          break;
        default:
          break;
      }
      // Default Solution - 추후 삭제 예정
      return res.status(200).json(message);
    } catch (err) {
      console.error(err);
      res.status(500).json({
        message: "Server Error - 500",
      });
    }
  },
  // Google Drive 파일 업로드 API
  postOpenAIGoogleDriveUpload: async (req, res) => {
    try {
      const { name, mimeType, data, pUid } = req.body;
      console.log(`Google Drive 파일 업로드 API 호출 - Uid:${pUid}`);
      const [type, imageBase64] = data.split(",");

      const bufferStream = new stream.PassThrough();
      bufferStream.end(Buffer.from(imageBase64, "base64"));

      const fileMetadata = {
        name,
      };

      const media = {
        mimeType,
        body: bufferStream,
      };

      // 파일 업로드
      const file = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: "id, webViewLink, webContentLink",
      });

      // 파일을 Public으로 설정
      await drive.permissions.create({
        fileId: file.data.id,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });

      // soyesnjy@gmail.com 계정에게 파일 공유 설정 (writer 권한)
      await drive.permissions.create({
        fileId: file.data.id,
        requestBody: {
          role: "writer",
          type: "user",
          emailAddress: "soyesnjy@gmail.com",
        },
        // transferOwnership: true, // role:'owner' 일 경우
      });

      // Public URL을 가져오기 위해 파일 정보를 다시 가져옴
      const updatedFile = await drive.files.get({
        fileId: file.data.id,
        fields: "id, webViewLink, webContentLink",
      });

      // 이미지 URL 생성
      const imageUrl = `https://drive.google.com/uc?export=view&id=${file.data.id}`;

      console.log("File uploaded and shared successfully");
      res.send({
        message: "File uploaded and shared successfully",
        webViewLink: updatedFile.data.webViewLink,
        webContentLink: updatedFile.data.webContentLink,
        imageUrl: imageUrl,
      });
    } catch (error) {
      console.log(error);
      res.status(500).send(error.message);
    }
  },
  // 이미지 인식 API
  postOpenAIAnalysisImg: async (req, res) => {
    try {
      const { name, mimeType, data, pUid } = req.body;
      // data:
      const [type, imageBase64] = data.split(",");

      // 이미지를 OpenAI API로 전송하여 인식 및 텍스트 생성
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "해당 이미지의 유저의 표정을 분석해줘. 유저가 보이지 않는다면 이미지를 설명해줘.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `${type},${imageBase64}`,
                },
              },
            ],
          },
        ],
      });

      res.json({ message: response.choices[0].message.content });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: "Failed to process the image" });
    }
  },
};
// 엘라 기분관리
const ellaMoodController = {
  // 훈련 트레이너 - 엘라 (New)
  postOpenAIEllaMoodTraning: async (req, res) => {
    const { data } = req.body;
    // console.log(data);
    let parseData,
      parseMessageArr = [],
      parsepUid; // Parsing 변수
    let promptArr = []; // 삽입 Prompt Array

    try {
      if (typeof data === "string") {
        parseData = JSON.parse(data);
      } else parseData = data;

      const {
        messageArr,
        pUid,
        code,
        mood_situation,
        mood_thought,
        mood_todo_list,
        mood_talk_list,
      } = parseData;

      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.json({ message: "No pUid input value - 400" });
      }
      // No type => return
      if (!code) {
        console.log("No code input value - 400");
        return res.json({ message: "No type input value - 400" });
      }
      // No type => return
      if (!messageArr) {
        console.log("No messageArr input value - 400");
        return res.json({ message: "No messageArr input value - 400" });
      }

      // pUid default값 설정
      parsepUid = pUid;
      console.log(`엘라 훈련 API 호출 - pUid: ${parsepUid}`);

      promptArr.push(persona_prompt_lala_v5); // 엘라 페르소나

      // code 매칭 프롬프트 삽입
      switch (code) {
        case "emotion":
          promptArr.push({
            role: "system",
            content: `유저가 마지막으로 한 말에 공감하되, 절대 질문으로 문장을 끝내지 않는다.`,
          });
          parseMessageArr = [...messageArr];
          break;
        case "situation":
          promptArr.push({
            role: "system",
            content: `아래 문장에 기초하여 유저에게 상황을 바꿀 방법을 생각해보게 한다.
            '''
            ${mood_situation}
            '''
            예시: '~할 때 ~를 만난다고 했어. 이 상황을 바꿀 방법이 있을까?'
            `,
          });
          parseMessageArr = [...messageArr];
          break;
        case "solution":
          promptArr.push({
            role: "system",
            content: `user가 잘 말하면 격려해준다. user가 말하지 않은 해결 방법을 하나 말해준다. 초등학교 6학년이 할 수 있는 방법이어야 한다.
            예시: '~해보면 어떨까?'
            `,
          });
          parseMessageArr = [...messageArr];
          break;
        case "thought":
          promptArr.push({
            role: "system",
            content: `아래 문장에 기초해서 다른 관점을 생각해보도록 한다.
            '''
            ${mood_thought}
            '''
            예시: '그건 정말 그래. 그런데 다르게도 생각해볼 수 있을까?'`,
          });
          parseMessageArr = [...messageArr];
          break;
        case "another":
          promptArr.push({
            role: "system",
            content: `User응답에 반응한 뒤 상황을 다른 관점으로는 어떻게 볼 수 있는지를 한 가지 제시한다. 
            "~해보는 것도 좋을 것 같아" `,
          });
          parseMessageArr = [...messageArr];
          break;
        case "listing":
          promptArr.push({
            role: "system",
            content: `아래 3개의 문장은 유저가 작성한 Todo List이다. 
보기좋게 다듬어서 목록 형식으로 나열한다. 
Todo List가 아니라고 판단되면 제외한다.
'''
1. ${mood_todo_list[0]}
2. ${mood_todo_list[1]}
3. ${mood_todo_list[2]}
'''
반드시 목록 형식으로 작성되어야 한다.`,
          });

          break;
        case "talking":
          promptArr.push({
            role: "system",
            content: `아래 3개의 문장은 유저가 mood_name에게 하고싶은 말이다.
보기좋게 다듬어서 목록 형식으로 나열한다.
'''
1. ${mood_talk_list[0]}
2. ${mood_talk_list[1]}
3. ${mood_talk_list[2]}
'''
반드시 목록 형식으로 작성되어야 한다.`,
          });
          break;
      }

      // console.log(promptArr);

      const response = await openai.chat.completions.create({
        messages: [...promptArr, ...parseMessageArr],
        model: "gpt-4o", // gpt-4-turbo, gpt-4-0125-preview, gpt-3.5-turbo-0125, ft:gpt-3.5-turbo-1106:personal::8fIksWK3
      });

      const message = {
        message: response.choices[0].message.content,
      };

      return res.status(200).json(message);
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        message: "Server Error - 500 Bad Gateway" + err.message,
      });
    }
  },
  // 기분 훈련 저장 API
  postOpenAIMoodDataSave: async (req, res) => {
    const { data } = req.body;
    // console.log(data);
    let parseData, parsepUid; // Parsing 변수

    try {
      // json 파싱
      if (typeof data === "string") {
        parseData = JSON.parse(data);
      } else parseData = data;

      const {
        pUid,
        type,
        mood_name,
        mood_cognitive_score,
        mood_todo_list,
        mood_talk_list,
      } = parseData;

      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.status(400).json({ message: "No pUid input value - 400" });
      }

      // No type => return
      if (!type) {
        console.log("No type input value - 400");
        return res.status(400).json({ message: "No type input value - 400" });
      }

      // pUid default값 설정
      parsepUid = pUid;

      console.log(
        `기분 훈련 저장 API /openAI/calendar Path 호출 - pUid: ${parsepUid}`
      );

      const table = Ella_Training_Table_Info["Mood"].table;
      const attribute = Ella_Training_Table_Info["Mood"].attribute;

      let update_query, update_value;

      // 1. SELECT User Mood Table Data
      const select_query = `SELECT * FROM ${table} WHERE ${attribute.fKey} = '${parsepUid}' ORDER BY created_at DESC LIMIT 1;`;
      const select_data = await fetchUserData(connection_AI, select_query);

      // console.log(select_data[0]);

      // TODO - Mood Table INSERT || UPDATE

      // 타입별 query, value 삽입
      switch (type) {
        case "first":
          const insert_query = `INSERT INTO ${table} (${attribute.fKey}, ${attribute.attr1}, ${attribute.attr2}, ${attribute.attr3}, ${attribute.attr6}) VALUES (?, ?, ?, ?, ?);`;
          // console.log(insert_query);
          const insert_value = [
            parsepUid,
            1,
            mood_name,
            mood_cognitive_score,
            "Ella",
          ];
          // console.log(insert_value);
          // LOCK - 2024.08.19 이후 해제 (1회기 Insert Query)
          if (false) {
            connection_AI.query(
              insert_query,
              insert_value,
              (error, rows, fields) => {
                if (error) console.log(error);
                else console.log("Mood First Insert Success!");
              }
            );
          }
          break;
        case "second":
          update_query = `UPDATE ${table} SET ${attribute.attr1} = ?, ${attribute.attr4} = ? WHERE ${attribute.pKey} = ?`;
          // console.log(update_query);
          update_value = [
            2,
            JSON.stringify(mood_todo_list),
            select_data[0].mood_idx,
          ];
          // console.log(update_value);
          connection_AI.query(
            update_query,
            update_value,
            (error, rows, fields) => {
              if (error) console.log(error);
              else console.log("Mood Second Update Success!");
            }
          );
          break;
        case "third":
          update_query = `UPDATE ${table} SET ${attribute.attr1} = ?, ${attribute.attr5} = ? WHERE ${attribute.pKey} = ?`;
          // console.log(update_query);
          update_value = [
            3,
            JSON.stringify(mood_talk_list),
            select_data[0].mood_idx,
          ];
          // console.log(update_value);
          connection_AI.query(
            update_query,
            update_value,
            (error, rows, fields) => {
              if (error) console.log(error);
              else console.log("Mood Third Update Success!");
            }
          );
          break;
        case "fourth":
          update_query = `UPDATE ${table} SET ${attribute.attr1} = ? WHERE ${attribute.pKey} = ?`;
          // console.log(update_query);
          update_value = [4, select_data[0].mood_idx];
          // console.log(update_value);
          connection_AI.query(
            update_query,
            update_value,
            (error, rows, fields) => {
              if (error) console.log(error);
              else console.log("Mood Fourth Update Success!");
            }
          );
          break;
      }
      return res.json({ message: "Mood Data Save Success!" });
    } catch (err) {
      console.error(err);
      res.json({
        message: "Server Error",
      });
    }
  },
  // 기분 훈련 데이터 Load API
  postOpenAIMoodDataLoad: async (req, res) => {
    const { data } = req.body;
    // console.log(data);
    let parseData, parsepUid; // Parsing 변수

    try {
      // json 파싱
      if (typeof data === "string") {
        parseData = JSON.parse(data);
      } else parseData = data;

      const { pUid } = parseData;

      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.status(400).json({ message: "No pUid input value - 400" });
      }

      // pUid default값 설정
      parsepUid = pUid;

      console.log(`기분 훈련 Data Load API 호출 - pUid: ${parsepUid}`);

      // LOCK - 2024.08.19 이후 해제 (Mood Table Select)
      if (false) {
        // Mood Table 명시
        const table = Ella_Training_Table_Info["Mood"].table;
        const attribute = Ella_Training_Table_Info["Mood"].attribute;
        // Mood Table User 조회
        const select_query = `SELECT * FROM ${table} WHERE ${attribute.fKey} = '${parsepUid}' ORDER BY created_at DESC LIMIT 1;`;
        const select_data = await fetchUserData(connection_AI, select_query);
        // case.1 - Row가 없거나 mood_round_idx값이 4일 경우: 기분관리 프로그램을 시작하는 인원. { mood_round_idx: 0, mood_name: "" } 반환
        if (!select_data[0] || select_data[0].mood_round_idx === 4)
          return res.json({ mood_round_idx: 0, mood_name: "" });
        // case.2 - Row가 있을 경우: 기분관리 프로그램을 진행했던 인원. { mood_round_idx: data.mood_round_idx, mood_name: data.mood_name } 반환
        else {
          return res.json({
            mood_round_idx: select_data[0].mood_round_idx,
            mood_name: select_data[0].mood_name,
          });
        }
      }
      // dummy data (임시)
      res.json({ mood_round_idx: 0, mood_name: "" });
    } catch (err) {
      console.error(err);
      res.json({
        message: "Server Error",
      });
    }
  },
};
// 북극이
const NorthController = {
  // 일기친구 모델 - 북극이 Save API
  postOpenAIConsultingNorthSave: async (req, res) => {
    const { data } = req.body;
    let parseData, parsepUid, parseMentalData; // Parsing 변수
    let promptArr = []; // 삽입 Prompt Array

    const tagArr = ["mood", "friend", "family", "school"];
    try {
      if (typeof data === "string") {
        parseData = JSON.parse(data);
      } else parseData = data;

      const { content, pUid, tag } = parseData;

      console.log(
        `북극이 일기 Save API /consulting_emotion_north Path 호출 - pUid: ${parsepUid}`
      );
      console.log(parseData);

      // No pUid => return
      if (!pUid || !content || !tag) {
        console.log("No Required input value - 400");
        return res
          .status(400)
          .json({ message: "No Required input value - 400" });
      }
      // tag 값이 지정된 값이 아닐 경우
      if (!tagArr.includes(tag)) {
        console.log("The specified tag value was not entered.- 400");
        return res
          .status(400)
          .json({ message: "The specified tag value was not entered.- 400" });
      }

      parsepUid = pUid;

      // 고정 삽입 프롬프트 - 유저 작성 일기 인지
      promptArr.push({
        role: "system",
        content: `다음에 오는 문장은 유저가 오늘 작성한 일기야.
        '''
        ${content}
        '''`,
      });

      // tag 매칭 프롬프트 삽입
      switch (tag) {
        case "mood":
          promptArr.push({
            role: "user",
            content: `일기를 분석하고 아래의 기준에 맞춰 유저의 기분에 대한 점수를 반환해줘.
            '''
            좋음: 2
            보통: 1
            나쁨: 0
            '''
            판단하기 힘들 경우 '보통'으로 판단하고 1을 반환해줘.
            반드시 정수값만 반환해야 해.`,
          });
          break;
        case "friend":
          promptArr.push({
            role: "user",
            content: `일기를 분석하고 아래의 기준에 맞춰 유저의 또래관계에 대한 점수를 반환해줘.
            '''
            좋음: 2
            보통: 1
            나쁨: 0
            '''
            판단하기 힘들 경우 '보통'으로 판단하고 1을 반환해줘.
            반드시 정수값만 반환해야 해.`,
          });
          break;
        case "family":
          promptArr.push({
            role: "user",
            content: `일기를 분석하고 아래의 기준에 맞춰 유저의 가족관계에 대한 점수를 반환해줘.
            '''
            좋음: 2
            보통: 1
            나쁨: 0
            '''
            판단하기 힘들 경우 '보통'으로 판단하고 1을 반환해줘.
            반드시 정수값만 반환해야 해.`,
          });
          break;
        case "school":
          promptArr.push({
            role: "user",
            content: `일기를 분석하고 아래의 기준에 맞춰 유저의 학교생활에 대한 점수를 반환해줘.
            '''
            좋음: 2
            보통: 1
            나쁨: 0
            '''
            판단하기 힘들 경우 '보통'으로 판단하고 1을 반환해줘.
            반드시 정수값만 반환해야 해.`,
          });
          break;
        case "study":
          promptArr.push({
            role: "user",
            content: `일기를 분석하고 아래의 기준에 맞춰 유저의 학업 성취도에 대한 점수를 반환해줘.
            '''
            좋음: 2
            보통: 1
            나쁨: 0
            '''
            판단하기 힘들 경우 '보통'으로 판단하고 1을 반환해줘.
            반드시 정수값만 반환해야 해.`,
          });
          break;
      }

      const response = await openai.chat.completions.create({
        messages: [...promptArr],
        model: "gpt-4o", // gpt-4-0125-preview, gpt-3.5-turbo-0125, ft:gpt-3.5-turbo-1106:personal::8fIksWK3
      });

      // MentalData 정의
      parseMentalData = !isNaN(response.choices[0].message.content)
        ? Number(response.choices[0].message.content)
        : 1;

      // DB Insert
      const table = North_Table_Info.table;

      // 1. SELECT User Mood Table Data
      // const select_query = `SELECT * FROM ${table} WHERE uid = '${parsepUid}' ORDER BY created_at DESC LIMIT 1;`;
      // const select_data = await fetchUserData(connection_AI, select_query);

      if (true) {
        const insert_query = `INSERT INTO ${table} (uid, north_diary_content, north_diary_tag, north_mental_data) VALUES (?, ?, ?, ?);`;
        // console.log(insert_query);
        const insert_value = [parsepUid, content, tag, parseMentalData];
        // console.log(insert_value);

        connection_AI.query(
          insert_query,
          insert_value,
          (error, rows, fields) => {
            if (error) {
              console.log(error);
              return res.status(400).json({ message: error.sqlMessage });
            }
            console.log(`North Insert Success! - ${parsepUid}`);
            return res
              .status(200)
              .json({ message: "North Diary Save Success!" });
          }
        );
      }

      // return res.status(200).json(message);
    } catch (err) {
      delete err.headers;
      console.error(err);
      return res.status(500).json({
        message: `Server Error : ${err.message}`,
      });
    }
  },
  // 일기친구 모델 - 북극이 Load API
  postOpenAIConsultingNorthLoad: async (req, res) => {
    const { data } = req.body;
    let parseData, parsepUid; // Parsing 변수

    try {
      if (typeof data === "string") {
        parseData = JSON.parse(data);
      } else parseData = data;

      const { pUid } = parseData;
      console.log(`북극이 일기 Load API /north_load Path 호출 - pUid: ${pUid}`);
      console.log(parseData);

      // No pUid => return
      if (!pUid) {
        console.log("No Required input value - 400");
        return res
          .status(400)
          .json({ message: "No Required input value - 400" });
      }

      parsepUid = pUid;

      // 오늘 날짜 변환
      const dateObj = new Date();
      const year = dateObj.getFullYear();

      // DB Select
      const table = North_Table_Info.table;

      // 1. SELECT User Mood Table Data
      const select_query = `SELECT
      north_id AS id,
      north_diary_content AS content,
      north_diary_tag AS tag,
      DATE_FORMAT(created_at, '%Y-%m-%d') AS date
      FROM ${table}
      WHERE uid = '${parsepUid}'
      AND created_at LIKE '%${year}%'
      ORDER BY created_at ASC;`;
      const select_data = await fetchUserData(connection_AI, select_query);

      return res
        .status(200)
        .json({ message: "North Diary Load Success!", data: select_data });
    } catch (err) {
      delete err.headers;
      console.error(err);
      return res.status(500).json({
        message: `Server Error : ${err.message}`,
      });
    }
  },
  // 일기친구 모델 - 북극이 일기 Delete API
  postOpenAIConsultingNorthDelete: async (req, res) => {
    const { data } = req.body;
    let parseData, parsepUid; // Parsing 변수

    try {
      if (typeof data === "string") {
        parseData = JSON.parse(data);
      } else parseData = data;

      const { pUid, id } = parseData;
      console.log(
        `북극이 일기 Delete API /north_delete Path 호출 - pUid: ${pUid}`
      );
      console.log(parseData);

      // No pUid => return
      if (!pUid) {
        console.log("No pUid input value - 400");
        return res.status(400).json({ message: "No pUid input value - 400" });
      }

      // No pUid => return
      if (!id) {
        console.log("No id input value - 400");
        return res.status(400).json({ message: "No id input value - 400" });
      }

      parsepUid = pUid;

      // Delete Qurty
      const table = North_Table_Info.table;
      const delete_query = `DELETE FROM ${table} WHERE north_id = ?`;

      // Delete 수행
      connection_AI.query(delete_query, [id], (err, results) => {
        if (err) {
          console.log(err);
          return res.status(400).json({ message: err.sqlMessage });
        }

        // 삭제된 행이 있는지 확인
        if (results.affectedRows > 0) {
          console.log("North Diary Delete Success!");
          return res
            .status(200)
            .json({ message: "North Diary Delete Success!" });
        } else {
          console.log("No rows deleted, possibly due to non-existing id.");
          return res
            .status(400)
            .json({ message: "No rows deleted, ID not found." });
        }
      });
    } catch (err) {
      delete err.headers;
      console.error(err);
      return res.status(500).json({
        message: `Server Error : ${err.message}`,
      });
    }
  },
};
// 결과보고서 (Web)
const reportController = {
  postReportTest: async (req, res) => {
    const { data } = req.body;
    const pdfBuffers = []; // 각 PDF의 버퍼를 저장할 배열
    let parsepUid, parseName, parseEmail, parseAge, parseGender;
    try {
      if (typeof data === "string") {
        parseData = JSON.parse(data);
      } else parseData = data;

      const { pUid, name, email, age, gender } = parseData;
      console.log(`결과보고서 발송 API /report Path 호출 - pUid: ${pUid}`);
      console.log(parseData);

      // No pUid => return
      if (!pUid || !name || !email || !age || !gender) {
        console.log("No Required input value - 400");
        return res
          .status(400)
          .json({ message: "No Required input value - 400" });
      }

      parsepUid = pUid;
      parseName = name;
      parseEmail = email;
      parseAge = age;
      parseGender = gender;

      // PDF 결합 함수
      async function mergePDFs(pdfBuffers) {
        const mergedPdf = await PDFDocument.create();

        for (const buffer of pdfBuffers) {
          const pdf = await PDFDocument.load(buffer);

          // 페이지를 복사하고 병합
          const copiedPages = await mergedPdf.copyPages(
            pdf,
            pdf.getPageIndices()
          );
          copiedPages.forEach((page) => mergedPdf.addPage(page));
        }

        const mergedPdfBytes = await mergedPdf.save();
        return mergedPdfBytes;
      }

      // DB Data Select
      let selectData = {
        report_url: process.env.REPORT_URL,
      };

      // console.log(process.env.REPORT_URL);

      // Page 1 Data
      const dateObj = new Date();
      const year = dateObj.getFullYear();
      const month = ("0" + (dateObj.getMonth() + 1)).slice(-2);
      const day = ("0" + dateObj.getDate()).slice(-2);
      const date = `${year}-${month}-${day}`;

      // Page 2 Data
      const north_table = North_Table_Info.table;
      const select_north_join_query = `SELECT JSON_OBJECT(
  'mood_data', IFNULL((SELECT JSON_ARRAYAGG(north_mental_data)
                FROM (SELECT north_mental_data
                      FROM ${north_table}
                      WHERE uid = '${parsepUid}' AND north_diary_tag = 'mood'
                      ORDER BY created_at DESC
                      LIMIT 5) AS mood), JSON_ARRAY()),
  'friend_data', IFNULL((SELECT JSON_ARRAYAGG(north_mental_data)
                  FROM (SELECT north_mental_data
                        FROM ${north_table}
                        WHERE uid = '${parsepUid}' AND north_diary_tag = 'friend'
                        ORDER BY created_at DESC
                        LIMIT 5) AS friend), JSON_ARRAY()),
  'family_data', IFNULL((SELECT JSON_ARRAYAGG(north_mental_data)
                  FROM (SELECT north_mental_data
                        FROM ${north_table}
                        WHERE uid = '${parsepUid}' AND north_diary_tag = 'family'
                        ORDER BY created_at DESC
                        LIMIT 5) AS family), JSON_ARRAY()),
  'school_data', IFNULL((SELECT JSON_ARRAYAGG(north_mental_data)
                  FROM (SELECT north_mental_data
                        FROM ${north_table}
                        WHERE uid = '${parsepUid}' AND north_diary_tag = 'school'
                        ORDER BY created_at DESC
                        LIMIT 5) AS school), JSON_ARRAY())
) AS result;
`;
      const north_join_data = await fetchUserData(
        connection_AI,
        select_north_join_query
      );
      const page2_data = JSON.parse(north_join_data[0].result);

      // Page 3,4 Data
      const page3_data = await select_soyesAI_EbtResult_v2("", true, parsepUid);
      // console.log(page3_data);

      // Page 5,6 Data
      const pt_log_table = PT_Table_Info["Log"].table;
      const select_pt_query = `SELECT 
      persanl_result FROM ${pt_log_table} 
      WHERE uid = '${parsepUid}' 
      ORDER BY created_at DESC LIMIT 1;`;

      const pt_data = await fetchUserData(connection_AI, select_pt_query);
      const page5_data = pt_data[0];

      // Page 7 Data
      // const mood_table = Ella_Training_Table_Info["Mood"].table;
      // const anxiety_table = Ella_Training_Table_Info["Anxiety"].table;

      // const mood_select_query = `SELECT
      // mood_rating_first,
      // mood_rating_second,
      // mood_rating_third,
      // mood_rating_fourth
      // FROM ${mood_table} WHERE uid = '${parsepUid}'
      // ORDER BY created_at DESC LIMIT 1;`;

      // const mood_select_data = await fetchUserData(
      //   connection_AI,
      //   mood_select_query
      // );
      // const page7_mood_data = mood_select_data[0]
      //   ? Object.values(mood_select_data[0]).filter((el) => el)
      //   : [];

      // const anxiety_select_query = `SELECT
      // anxiety_rating_first,
      // anxiety_rating_second,
      // anxiety_rating_third,
      // anxiety_rating_fourth,
      // anxiety_rating_fifth
      // FROM ${anxiety_table} WHERE uid = '${parsepUid}'
      // ORDER BY created_at DESC LIMIT 1;`;

      // const anxiety_select_data = await fetchUserData(
      //   connection_AI,
      //   anxiety_select_query
      // );
      // const page7_anxiety_data = anxiety_select_data[0]
      //   ? Object.values(anxiety_select_data[0]).filter((el) => el)
      //   : [];

      // // Page 8 Data
      // const friend_table = Ella_Training_Table_Info["Friend"].table;
      // const friend_select_query = `SELECT
      // friend_result
      // FROM ${friend_table}
      // WHERE uid = '${parsepUid}' AND friend_type = 'friend_test'
      // ORDER BY created_at DESC LIMIT 1;`;

      // const friend_select_data = await fetchUserData(
      //   connection_AI,
      //   friend_select_query
      // );
      // const page8_friend_data = friend_select_data[0]?.friend_result;

      // Page Career Data
      const ct_table = CT_Table_Info["Main"].table;
      const ct_select_query = `SELECT 
      ct_career_first,
      ct_career_second,
      ct_career_third
      FROM ${ct_table}
      WHERE uid ='${parsepUid}'
      ORDER BY ct_created_at DESC
      LIMIT 1`;

      const ct_select_data = await fetchUserData(
        connection_AI,
        ct_select_query
      );

      const { ct_career_first, ct_career_second, ct_career_third } =
        ct_select_data.length
          ? ct_select_data[0]
          : { ct_career_first: -1, ct_career_second: -1, ct_career_third: -1 };

      // Page 9 Data
      const pupu_table = Consult_Table_Info["Log"].table;
      const pupu_select_query = `SELECT consult_log FROM ${pupu_table} WHERE uid ='${parsepUid}' ORDER BY created_at DESC LIMIT 3`; // 가장 최근 검사 결과를 조회하는 경우

      const pupu_select_data = await fetchUserData(
        connection_AI,
        pupu_select_query
      );

      const page9_pupu_data = pupu_select_data
        .map((el) => JSON.parse(el.consult_log))
        .map((el) => (el.length > 0 ? el[el.length - 1].content : ""));

      // Select Data 갱신
      selectData = {
        ...selectData,
        // page 1
        reportDate: date,
        name: parseName,
        age: parseAge,
        gender: parseGender,
        // page 2
        moodData: JSON.stringify(page2_data.mood_data.map((el) => el + 1)),
        friendData: JSON.stringify(page2_data.friend_data.map((el) => el + 1)),
        familyData: JSON.stringify(page2_data.family_data.map((el) => el + 1)),
        schoolData: JSON.stringify(page2_data.school_data.map((el) => el + 1)),
        // page 3
        ebt_school: page3_data[0]?.content?.slice(0, 135),
        ebt_school_result: ebtResultMap[page3_data[0]?.result || "default"],
        ebt_friend: page3_data[1]?.content?.slice(0, 135),
        ebt_friend_result: ebtResultMap[page3_data[1]?.result || "default"],
        ebt_family: page3_data[2]?.content?.slice(0, 135),
        ebt_family_result: ebtResultMap[page3_data[2]?.result || "default"],
        ebt_tScores: JSON.stringify(
          page3_data.length > 0
            ? page3_data.map((el) => el.tScore || 50)
            : [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
        ),
        // page 4
        ebt_self: page3_data[3]?.content?.slice(0, 130),
        ebt_self_result: ebtResultMap[page3_data[3]?.result || "default"],
        ebt_unrest: page3_data[4]?.content?.slice(0, 130),
        ebt_unrest_result: ebtResultMap[page3_data[4]?.result || "default"],
        ebt_sad: page3_data[5]?.content?.slice(0, 130),
        ebt_sad_result: ebtResultMap[page3_data[5]?.result || "default"],
        ebt_health: page3_data[6]?.content?.slice(0, 130),
        ebt_health_result: ebtResultMap[page3_data[6]?.result || "default"],
        ebt_attention: page3_data[7]?.content?.slice(0, 130),
        ebt_attention_result: ebtResultMap[page3_data[7]?.result || "default"],
        ebt_movement: page3_data[8]?.content?.slice(0, 130),
        ebt_movement_result: ebtResultMap[page3_data[8]?.result || "default"],
        ebt_mood: page3_data[9]?.content?.slice(0, 130),
        ebt_mood_result: ebtResultMap[page3_data[9]?.result || "default"],
        ebt_angry: page3_data[10]?.content?.slice(0, 130),
        ebt_angry_result: ebtResultMap[page3_data[10]?.result || "default"],
        // page 5
        persnalResult: page5_data?.persanl_result || "pt_default",
        result_first: page5_data?.persanl_result[0] || "pt_detail_default",
        result_second: page5_data?.persanl_result[1] || "pt_detail_default",
        result_third: page5_data?.persanl_result[2] || "pt_detail_default",
        result_fourth: page5_data?.persanl_result[3] || "pt_detail_default",
        // page 6
        result_first_ment:
          ptResultMap[page5_data?.persanl_result[0] || "default"],
        result_second_ment:
          ptResultMap[page5_data?.persanl_result[1] || "default"],
        result_third_ment:
          ptResultMap[page5_data?.persanl_result[2] || "default"],
        result_fourth_ment:
          ptResultMap[page5_data?.persanl_result[3] || "default"],
        // page 7
        // mood_scores: JSON.stringify(page7_mood_data),
        // anxiety_scores: JSON.stringify(page7_anxiety_data),
        // // page 8
        // friend_result: friendMap[page8_friend_data || "default"]?.category,
        // friend_result_img: page8_friend_data || "default",
        // friend_result_ment: friendMap[page8_friend_data || "default"]?.ment,
        // page Career
        // first
        career_first_career_id:
          ct_career_first !== -1
            ? careerMap[ct_career_first].careerId
            : "default",
        career_first_name:
          ct_career_first !== -1
            ? careerMap[ct_career_first].careerName
            : "default",
        career_first_content:
          ct_career_first !== -1
            ? careerMap[ct_career_first].careerIntroduce
            : "default",
        career_first_type_sub_content:
          ct_career_first !== -1
            ? carrerTypeMap[careerMap[ct_career_first].careerType].subContent
            : "default",
        career_first_type_main_content:
          ct_career_first !== -1
            ? carrerTypeMap[careerMap[ct_career_first].careerType].mainContent
            : "default",
        career_first_type:
          ct_career_first !== -1
            ? careerMap[ct_career_first].careerType
            : "default",
        career_first_es_content:
          ct_career_first !== -1
            ? carrerTypeMap[
                careerMap[ct_career_first].careerType
              ].esContent.slice(1)
            : "default",
        career_first_carrer_abilitys:
          ct_career_first !== -1
            ? careerMap[ct_career_first].carrerAbility.join(", ")
            : "default",
        // second
        career_second_career_id:
          ct_career_second !== -1
            ? careerMap[ct_career_second].careerId
            : "default",
        career_second_name:
          ct_career_second !== -1
            ? careerMap[ct_career_second].careerName
            : "default",
        career_second_content:
          ct_career_second !== -1
            ? careerMap[ct_career_second].careerIntroduce
            : "default",
        career_second_type_sub_content:
          ct_career_second !== -1
            ? carrerTypeMap[careerMap[ct_career_second].careerType].subContent
            : "default",
        career_second_type_main_content:
          ct_career_second !== -1
            ? carrerTypeMap[careerMap[ct_career_second].careerType].mainContent
            : "default",
        career_second_type:
          ct_career_second !== -1
            ? careerMap[ct_career_second].careerType
            : "default",
        career_second_es_content:
          ct_career_second !== -1
            ? carrerTypeMap[
                careerMap[ct_career_second].careerType
              ].esContent.slice(1)
            : "default",
        career_second_carrer_abilitys:
          ct_career_second !== -1
            ? careerMap[ct_career_second].carrerAbility.join(", ")
            : "default",
        // third
        career_third_career_id:
          ct_career_third !== -1
            ? careerMap[ct_career_third].careerId
            : "default",
        career_third_name:
          ct_career_third !== -1
            ? careerMap[ct_career_third].careerName
            : "default",
        career_third_content:
          ct_career_third !== -1
            ? careerMap[ct_career_third].careerIntroduce
            : "default",
        career_third_type_sub_content:
          ct_career_third !== -1
            ? carrerTypeMap[careerMap[ct_career_third].careerType].subContent
            : "default",
        career_third_type_main_content:
          ct_career_third !== -1
            ? carrerTypeMap[careerMap[ct_career_third].careerType].mainContent
            : "default",
        career_third_type:
          ct_career_third !== -1
            ? careerMap[ct_career_third].careerType
            : "default",
        career_third_es_content:
          ct_career_third !== -1
            ? carrerTypeMap[
                careerMap[ct_career_third].careerType
              ].esContent.slice(1)
            : "default",
        career_third_carrer_abilitys:
          ct_career_third !== -1
            ? careerMap[ct_career_third].carrerAbility.join(", ")
            : "default",

        // page 9
        pupu_analysis_1: page9_pupu_data[0]?.slice(0, 170),
        pupu_analysis_2: page9_pupu_data[1]
          ? page9_pupu_data[1]?.slice(0, 170)
          : "상담 내역이 없습니다!",
        pupu_analysis_3: page9_pupu_data[2]
          ? page9_pupu_data[2]?.slice(0, 170)
          : "상담 내역이 없습니다!",
      };

      // 변환할 EJS 파일들의 경로를 배열로 설정
      const ejsFiles = [
        "1.ejs",
        "2.ejs",
        "3.ejs",
        "4.ejs",
        "5.ejs",
        "6.ejs",
        "career.ejs",
        // 엘라 제외
        // "7.ejs",
        // "8.ejs",
        "9.ejs",
      ];

      // Puppeteer 브라우저 실행
      const browser = await puppeteer.launch({
        headless: true, // 백그라운드 모드로 실행
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--fontconfig"], // 샌드박스 모드 비활성화
      });

      for (const file of ejsFiles) {
        const templatePath = path.join(
          __dirname,
          "..",
          "src",
          "report_final",
          file
        );
        const htmlContent = await ejs.renderFile(templatePath, selectData);

        const page = await browser.newPage();

        await page.emulateMediaType("screen"); // 화면 스타일 적용

        // 원하는 뷰포트 크기 설정
        // await page.setViewport({
        //   width: 909, // 너비 909px
        //   height: 1986, // 높이 1986px
        // });

        await page.setContent(htmlContent, { waitUntil: "networkidle0" });

        // 개별 PDF 생성
        const pdfBuffer = await page.pdf({
          width: "909px",
          height: "1286px",
          printBackground: true,
        });

        pdfBuffers.push(pdfBuffer);
      }

      const mergedPdfBuffer = await mergePDFs(pdfBuffers);

      await browser.close();

      // 이메일 전송 설정
      let myMailAddr = process.env.ADDR_MAIL; // 보내는 사람 메일 주소
      let myMailPwd = process.env.ADDR_PWD; // 구글 계정 2단계 인증 비밀번호

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: myMailAddr,
          pass: myMailPwd,
        },
      });

      const mailOptions = {
        from: "soyesnjy@gmail.com",
        to: parseEmail,
        subject: "SoyeAI 결과보고서",
        text: "SoyeAI 결과보고서 입니다.",
        attachments: [
          {
            filename: "Soyes_Report_Test.pdf",
            content: mergedPdfBuffer,
          },
        ],
      };

      await transporter.sendMail(mailOptions);
      return res.status(200).json({ message: "PDF sent successfully" });
    } catch (err) {
      delete err.headers;
      console.error(err);
      return res.status(500).json({
        message: `Server Error : ${err.message}`,
      });
    }
  },
};

module.exports = {
  openAIController,
  ellaMoodController,
  NorthController,
  reportController,
  // openAIController_Regercy,
};
