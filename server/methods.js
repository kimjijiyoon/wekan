import { HTTP } from 'meteor/http';
import { check } from 'meteor/check';

// 웹훅 공통 함수 import
let sendCardWebhookManual;
if (Meteor.isServer) {
  try {
    // card-opened-webhook.js에서 export한 함수 가져오기
    if (typeof global !== 'undefined' && global.sendCardWebhookManual) {
      sendCardWebhookManual = global.sendCardWebhookManual;
    } else {
      // 파일에서 직접 require (fallback)
      const webhookModule = require('./notifications/card-opened-webhook');
      sendCardWebhookManual = webhookModule.sendCardWebhookManual;
    }
  } catch (error) {
    console.error('[sendCardWebhookManual import 실패]', error);
  }
}

Meteor.methods({
  async fetchApiDropdownData(url, method = 'POST') {
    check(url, String);
    check(method, Match.Optional(String));

    console.log('[API 요청]', {
      url,
      method,
      timestamp: new Date().toISOString()
    });

    try {
      // HTTP 요청 설정
      const requestOptions = {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 5000  // 5초 타임아웃
      };

      // POST 요청인 경우 빈 데이터 추가
      if (method.toUpperCase() === 'POST') {
        requestOptions.data = {};
      }

      const result = HTTP.call(method, url, requestOptions);

      console.log('[API 응답]', {
        statusCode: result.statusCode,
        headers: result.headers,
        dataLength: result.data ? JSON.stringify(result.data).length : 0,
        data: result.data ? JSON.stringify(result.data) : ''
      });

      // 응답이 성공적이고 데이터가 있는 경우
      if (result.statusCode === 200 && result.data) {
        return result.data;
      } else {
        throw new Meteor.Error('api-error', `API 응답 오류: ${result.statusCode}`);
      }

    } catch (error) {
      console.error('[API 호출 실패]', {
        error: error.message,
        response: error.response,
        url,
        method
      });

      // 클라이언트에 더 자세한 에러 정보 전달
      throw new Meteor.Error(
        'api-error',
        `API 호출 실패: ${error.message}`,
        {
          url,
          method,
          statusCode: error.response?.statusCode,
          details: error.response?.content
        }
      );
    }
  },

  async sendManualWebhook(cardId) {
    check(cardId, String);

    console.log(`[수동 웹훅] 카드(${cardId}) 웹훅 전송 시작`);

    try {
      const card = Cards.findOne({ _id: cardId });
      if (!card) {
        throw new Meteor.Error('card-not-found', '카드를 찾을 수 없습니다.');
      }

      if (!sendCardWebhookManual) {
        throw new Meteor.Error('webhook-function-not-available', '웹훅 함수를 사용할 수 없습니다.');
      }

      // 공통 웹훅 함수 사용
      const result = await sendCardWebhookManual(card, 'manualWebhookTrigger');

      if (!result.success) {
        throw new Meteor.Error('webhook-send-failed', result.message);
      }

      return result;

    } catch (error) {
      console.error(`[수동 웹훅 오류] 카드(${cardId}):`, error);
      throw new Meteor.Error('webhook-send-failed', error.reason || error.message);
    }
  }
});
