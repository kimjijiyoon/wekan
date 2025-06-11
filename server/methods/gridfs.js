import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { Attachments } from '/models/attachments';
import { FilesCollection } from 'meteor/ostrio:files';
import { fileStoreStrategyFactory } from '/models/attachments';
import { STORAGE_NAME_GRIDFS } from '/models/lib/fileStoreStrategy';
import { ReactiveCache } from '/imports/reactiveCache';
import { EJSON } from 'meteor/ejson';

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

Meteor.methods({
  moveAttachmentToGridFS(fileId) {
    check(fileId, String);

    // 사용자 권한 확인
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

        // 보드 멤버 권한 확인
        const board = ReactiveCache.getBoard(attachment.meta.boardId);
        if (!board || !board.hasMember(userId)) {
          throw new Meteor.Error('not-authorized', '보드 멤버만 파일을 이동할 수 있습니다.');
        }

        // 파일 유효성 검사
        if (!attachment.isValid()) {
          throw new Meteor.Error('invalid-file', '유효하지 않은 파일입니다.');
        }

        // GridFS로 파일 이동
        const fileData = attachment.versions.original.data;
        if (!fileData) {
          throw new Meteor.Error('no-data', '파일 데이터가 없습니다.');
        }

        const fileObj = {
          _id: attachment._id,
          filename: attachment.name,
          contentType: attachment.type,
          length: attachment.size,
          metadata: {
            userId: userId,
            boardId: attachment.meta.boardId,
            cardId: attachment.meta.cardId,
            originalAttachmentId: attachment._id
          }
        };

        // GridFS에 파일 저장
        const result = await GridFSFiles.insert(fileObj, fileData);
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
  },

  // 텍스트 기반 파일 업로드
  uploadFileAsText(fileData, fileName, fileType) {
    check(fileData, Match.OneOf(Object, String, Buffer, Uint8Array, Array));
    check(fileName, String);
    check(fileType, String);

    const userId = this.userId;
    if (!userId) {
      throw new Meteor.Error('not-authorized', '권한이 없습니다.');
    }

    try {
      // 파일 데이터를 Buffer로 변환
      let buffer;
      if (Buffer.isBuffer(fileData)) {
        buffer = fileData;
      } else if (Array.isArray(fileData)) {
        buffer = Buffer.from(fileData);
      } else if (typeof fileData === 'string') {
        buffer = Buffer.from(fileData);
      } else if (fileData instanceof Uint8Array) {
        buffer = Buffer.from(fileData);
      } else if (typeof fileData === 'object') {
        // EJSON으로 직렬화된 데이터 처리
        const data = EJSON.parse(EJSON.stringify(fileData));
        buffer = Buffer.from(data);
      } else {
        throw new Meteor.Error('invalid-data', '지원하지 않는 파일 데이터 형식입니다.');
      }

      // 파일 객체 생성
      const fileObj = {
        _id: new Meteor.Collection.ObjectID().toString(),
        filename: fileName,
        contentType: fileType,
        length: buffer.length,
        metadata: {
          userId: userId,
          uploadMethod: 'text',
          originalName: fileName
        }
      };

      // GridFS에 저장
      const result = GridFSFiles.insert(fileObj, buffer);
      if (!result) {
        throw new Meteor.Error('upload-failed', '파일 저장에 실패했습니다.');
      }

      return {
        success: true,
        fileId: result._id,
        message: '파일이 성공적으로 업로드되었습니다.'
      };
    } catch (error) {
      console.error('텍스트 파일 업로드 실패:', error);
      throw new Meteor.Error('upload-failed', error.message);
    }
  },

  // 청크 단위 파일 업로드
  uploadFileChunk(chunkData, fileName, fileType, chunkIndex, totalChunks) {
    check(chunkData, Object);
    check(fileName, String);
    check(fileType, String);
    check(chunkIndex, Number);
    check(totalChunks, Number);

    const userId = this.userId;
    if (!userId) {
      throw new Meteor.Error('not-authorized', '권한이 없습니다.');
    }

    try {
      // 임시 저장소에 청크 저장
      const chunkKey = `chunk_${fileName}_${chunkIndex}`;
      const result = GridFSFiles.insert({
        _id: chunkKey,
        filename: fileName,
        contentType: fileType,
        length: chunkData.length,
        metadata: {
          userId: userId,
          chunkIndex: chunkIndex,
          totalChunks: totalChunks,
          isChunk: true,
          originalName: fileName
        }
      }, chunkData);

      if (!result) {
        throw new Meteor.Error('upload-failed', '청크 저장에 실패했습니다.');
      }

      // 모든 청크가 업로드되었는지 확인
      if (chunkIndex === totalChunks - 1) {
        // 청크들을 하나로 합치기
        const chunks = [];
        for (let i = 0; i < totalChunks; i++) {
          const chunk = GridFSFiles.findOne(`chunk_${fileName}_${i}`);
          if (chunk) {
            chunks.push(chunk);
          }
        }

        if (chunks.length === totalChunks) {
          // 최종 파일 생성
          const finalBuffer = Buffer.concat(chunks.map(chunk => chunk.data));
          const fileObj = {
            _id: new Meteor.Collection.ObjectID().toString(),
            filename: fileName,
            contentType: fileType,
            length: finalBuffer.length,
            metadata: {
              userId: userId,
              uploadMethod: 'chunks',
              originalName: fileName
            }
          };

          // 임시 청크들 삭제
          chunks.forEach(chunk => GridFSFiles.remove(chunk._id));

          // 최종 파일 저장
          const finalResult = GridFSFiles.insert(fileObj, finalBuffer);
          if (!finalResult) {
            throw new Meteor.Error('upload-failed', '최종 파일 저장에 실패했습니다.');
          }

          return {
            success: true,
            fileId: finalResult._id,
            message: '파일이 성공적으로 업로드되었습니다.'
          };
        }
      }

      return {
        success: true,
        message: '청크 업로드 완료',
        chunkIndex: chunkIndex,
        totalChunks: totalChunks
      };
    } catch (error) {
      console.error('청크 업로드 실패:', error);
      throw new Meteor.Error('upload-failed', error.message);
    }
  }
});
