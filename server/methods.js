import { HTTP } from 'meteor/http';
import { check } from 'meteor/check';

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
  }
});
