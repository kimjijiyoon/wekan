import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { Attachments } from '/models/attachments';
import { FilesCollection } from 'meteor/ostrio:files';
import { fileStoreStrategyFactory } from '/models/attachments';
import { STORAGE_NAME_GRIDFS } from '/models/lib/fileStoreStrategy';
import { ReactiveCache } from '/imports/reactiveCache';
import os from 'os';
import path from 'path';

// GridFS 버킷 생성
const GridFSFiles = new FilesCollection({
  collectionName: 'gridfs_files',
  allowClientCode: false,
  storagePath: 'gridfs_files',
  onBeforeUpload(file) {
    // 파일 크기 제한 (10MB)
    if (file.size > 10 * 1024 * 1024) {
      return '파일 크기는 10MB를 초과할 수 없습니다.';
    }
    return true;
  },
  // MongoDB 연결 설정
  connection: {
    retryWrites: true,
    w: 'majority',
    wtimeoutMS: 2500,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    serverSelectionTimeoutMS: 10000,
    heartbeatFrequencyMS: 10000
  }
});

// MongoDB 연결 재시도 로직
const retryOperation = async (operation, maxRetries = 3) => {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error.name === 'PoolClearedOnNetworkError') {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

// GridFS 파일 저장 헬퍼 함수
// fileData: Buffer | String | ReadStream
// options: { name: String, type: String, size?: Number }
// metadata: Object (JSON 직렬화 가능 값만 포함)
const saveToGridFS = async (fileData, options, metadata = {}) => {
  try {
    const tmpDir = os.tmpdir();
    const tmpFilePath = path.join(tmpDir, `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    require('fs').writeFileSync(tmpFilePath, fileData);

    return await new Promise((resolve, reject) => {
      GridFSFiles.addFile(tmpFilePath, {
        fileName: options.name,
        type: options.type,
        size: options.size,
        meta: metadata
      }, (err, fileRef) => {
        require('fs').unlinkSync(tmpFilePath);
        if (err) {
          reject(err);
        } else {
          resolve(fileRef);
        }
      });
    });
  } catch (error) {
    console.error('GridFS 파일 저장 실패:', error);
    throw new Meteor.Error('upload-failed', '파일 업로드에 실패했습니다.');
  }
};

Meteor.methods({
  moveAttachmentToGridFS(fileId) {
    check(fileId, String);

    const userId = this.userId;
    if (!userId) {
      throw new Meteor.Error('not-authorized', '권한이 없습니다.');
    }

    return retryOperation(async () => {
      try {
        const attachment = Attachments.findOne(fileId);
        if (!attachment) {
          throw new Meteor.Error('not-found', '파일을 찾을 수 없습니다.');
        }

        // 원본 파일 정보 저장
        const originalName = attachment.name;
        const originalType = attachment.type;
        const originalExtension = originalName.split('.').pop();

        // 파일 확장자 변경
        const newFileName = originalName.replace(/\.(txt|md|xlsx|xls|doc|docx|ppt|pptx)$/, '.zip');

        // GridFS로 파일 이동
        const fileData = attachment.versions.original.data;
        if (!fileData) {
          throw new Meteor.Error('no-data', '파일 데이터가 없습니다.');
        }

        console.log('addFile fileData:', typeof fileData, fileData && fileData.constructor && fileData.constructor.name);
        console.log('addFile options:', options);

        const meta = {
          userId: userId,
          boardId: attachment.meta.boardId,
          cardId: attachment.meta.cardId,
          originalAttachmentId: attachment._id,
          originalName: originalName,
          originalType: originalType,
          originalExtension: originalExtension,
          isModified: true
        };

        // saveToGridFS 헬퍼 함수 사용
        const result = await saveToGridFS(
          fileData,
          {
            name: newFileName,
            type: 'application/zip',
            size: fileData.length
          },
          meta
        );

        if (!result) {
          throw new Meteor.Error('upload-failed', '파일 업로드에 실패했습니다.');
        }

        return {
          success: true,
          message: '파일이 GridFS로 이동되었습니다.'
        };
      } catch (error) {
        console.error('파일 이동 실패:', error);
        throw new Meteor.Error(
          error.error || 'unknown-error',
          error.reason || error.message || '파일 이동 중 오류가 발생했습니다.'
        );
      }
    });
  },

  migrateAllAttachmentsToGridFS() {
    const userId = this.userId;
    if (!userId) {
      throw new Meteor.Error('not-authorized', '권한이 없습니다.');
    }

    try {
      const attachments = Attachments.find({}).fetch();
      const results = {
        success: 0,
        failed: 0,
        errors: []
      };

      attachments.forEach(attachment => {
        try {
          // 보드 멤버 권한 확인
          const board = ReactiveCache.getBoard(attachment.meta.boardId);
          if (!board || !board.hasMember(userId)) {
            throw new Meteor.Error('not-authorized', '보드 멤버만 파일을 이동할 수 있습니다.');
          }

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
        message: `${results.success}개의 파일이 성공적으로 이동되었습니다.`,
        failed: results.failed,
        errors: results.errors
      };
    } catch (error) {
      console.error('전체 파일 이동 실패:', error);
      throw new Meteor.Error(
        error.error || 'unknown-error',
        error.reason || error.message || '파일 이동 중 오류가 발생했습니다.'
      );
    }
  },

  // GridFS에서 파일 삭제
  removeFileFromGridFS(fileId) {
    check(fileId, String);

    const userId = this.userId;
    if (!userId) {
      throw new Meteor.Error('not-authorized', '권한이 없습니다.');
    }

    try {
      const file = GridFSFiles.findOne({ _id: fileId });
      if (!file) {
        throw new Meteor.Error('file-not-found', '파일을 찾을 수 없습니다.');
      }

      // 보드 멤버 권한 확인
      const board = ReactiveCache.getBoard(file.metadata.boardId);
      if (!board || !board.hasMember(userId)) {
        throw new Meteor.Error('not-authorized', '보드 멤버만 파일을 삭제할 수 있습니다.');
      }

      // GridFS에서 파일 삭제
      GridFSFiles.remove({ _id: fileId });

      return { success: true, message: '파일이 삭제되었습니다.' };
    } catch (error) {
      console.error('GridFS 파일 삭제 실패:', error);
      throw new Meteor.Error('remove-failed', error.message);
    }
  },

  // GridFS 파일 정보 조회
  getGridFSFileInfo(fileId) {
    check(fileId, String);

    const userId = this.userId;
    if (!userId) {
      throw new Meteor.Error('not-authorized', '권한이 없습니다.');
    }

    try {
      const file = GridFSFiles.findOne({ _id: fileId });
      if (!file) {
        throw new Meteor.Error('file-not-found', '파일을 찾을 수 없습니다.');
      }

      // 보드 멤버 권한 확인
      const board = ReactiveCache.getBoard(file.metadata.boardId);
      if (!board || !board.hasMember(userId)) {
        throw new Meteor.Error('not-authorized', '보드 멤버만 파일 정보를 조회할 수 있습니다.');
      }

      return {
        success: true,
        fileInfo: {
          id: file._id,
          filename: file.name,
          contentType: file.type,
          length: file.size,
          uploadDate: file.uploadedAt,
          metadata: file.meta
        }
      };
    } catch (error) {
      console.error('GridFS 파일 정보 조회 실패:', error);
      throw new Meteor.Error('get-info-failed', error.message);
    }
  }
});

export { GridFSFiles, saveToGridFS };
