import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ApiTemplates } from '/models/cardTemplates';
import { HTTP } from 'meteor/http';
import { Attachments } from '/models/attachments';

Meteor.methods({
  updateApiTemplates(params) {
    // 전체 객체 구조 검증
    check(params, {
      parentTemplateId: String,
      url: String,
      boardId: String
    });

    const { parentTemplateId, url, boardId } = params;

    // 사용자 권한 확인
    if (!Meteor.userId()) {
      throw new Meteor.Error('not-authorized', '로그인이 필요합니다.');
    }

    try {
      console.log('기존 템플릿 삭제 시도');
      const removeCount = ApiTemplates.remove({ parentTemplateId });
      console.log(`${removeCount}개의 템플릿 삭제됨`);

      console.log('HTTP 요청 시도:', url);
      let response;
      try {
        response = HTTP.post(url, {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000
        });
      } catch (httpError) {
        console.error('[API 템플릿][HTTP 요청 실패]', {
          url,
          params,
          error: httpError,
          time: new Date().toISOString(),
        });
        if (httpError.response) {
          console.error('[API 템플릿][HTTP 응답]', httpError.response);
        }
        throw new Meteor.Error('http-error', `API 요청 실패: ${httpError.message}`);
      }

      if (!response.content) {
        console.error('[API 템플릿][응답 내용 없음]', {
          url,
          params,
          response,
          time: new Date().toISOString(),
        });
        throw new Meteor.Error('empty-response', 'API 응답이 비어있습니다.');
      }

      let parsed;
      try {
        parsed = JSON.parse(response.content);
        console.log('[API 템플릿][JSON 파싱 성공]', {
          url,
          params,
          parsed,
          time: new Date().toISOString(),
        });
      } catch (parseError) {
        console.error('[API 템플릿][JSON 파싱 실패]', {
          url,
          params,
          content: response.content,
          error: parseError,
          time: new Date().toISOString(),
        });
        throw new Meteor.Error('parse-error', 'API 응답을 파싱할 수 없습니다.');
      }

      // files 키로 묶인 배열 형태 확인
      if (!parsed.files || !Array.isArray(parsed.files)) {
        console.error('[API 템플릿][응답이 files 배열이 아님]', {
          url,
          params,
          parsed,
          time: new Date().toISOString(),
        });
        throw new Meteor.Error('invalid-format', 'API 응답이 { files: [...] } 형식이어야 합니다.');
      }

      const templates = parsed.files;
      console.log('템플릿 삽입 시작:', templates.length, '개의 템플릿');

      const insertedIds = templates.map(template => {
        const insertResult = ApiTemplates.insert({
          parentTemplateId,
          title: template.title || '제목 없음',
          description: template.description || '',
          boardId,
          userId: Meteor.userId(),
          createdAt: new Date(),
          enabled: true
        });
        console.log('[API 템플릿][템플릿 삽입]', {
          template,
          insertResult,
          time: new Date().toISOString(),
        });
        return insertResult;
      });

      console.log('작업 완료:', insertedIds.length, '개의 템플릿 추가됨');
      return {
        success: true,
        count: insertedIds.length
      };

    } catch (error) {
      console.error('[API 템플릿][전체 처리 실패]', {
        url: params?.url,
        params,
        error,
        time: new Date().toISOString(),
      });
      throw new Meteor.Error(
        error.error || 'unknown-error',
        error.reason || error.message || '알 수 없는 오류가 발생했습니다.'
      );
    }
  },

  createCardActivity(params) {
    check(params, {
      cardId: String,
      boardId: String,
      listId: String,
      swimlaneId: String,
      cardTitle: String
    });

    if (!this.userId) {
      throw new Meteor.Error('not-authorized');
    }

    Activities.insert({
      userId: this.userId,
      activityType: 'createCard',
      boardId: params.boardId,
      listId: params.listId,
      swimlaneId: params.swimlaneId,
      cardId: params.cardId,
      cardTitle: params.cardTitle,
      createdAt: new Date(),
    });
  },

  // GridFS로 파일 이동
  moveAllAttachmentsToGridFS() {
    if (!Meteor.userId()) {
      throw new Meteor.Error('not-authorized', '권한이 없습니다.');
    }

    const attachments = Attachments.find({}).fetch();
    const results = {
      total: attachments.length,
      success: 0,
      failed: 0,
      errors: []
    };

    attachments.forEach(attachment => {
      try {
        Meteor.call('moveAttachmentToGridFS', attachment._id);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          fileId: attachment._id,
          error: error.message
        });
      }
    });

    return {
      success: true,
      message: `${results.success}개의 파일이 GridFS로 이동되었습니다.`,
      details: {
        total: results.total,
        success: results.success,
        failed: results.failed,
        errors: results.errors
      }
    };
  }
});
