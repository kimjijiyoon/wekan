import { Meteor } from 'meteor/meteor';
import { Attachments } from '/models/attachments';
import { createBucket } from '/models/lib/grid/createBucket';
import { fileStoreStrategyFactory } from '/models/attachments';
import { STORAGE_NAME_GRIDFS } from '/models/lib/fileStoreStrategy';

if (Meteor.isServer) {
  describe('GridFS 테스트', () => {
    // 테스트용 GridFS 버킷 생성
    const testBucket = createBucket('test-attachments');

    // 테스트용 파일 데이터
    const testFile = {
      _id: 'test-file-id',
      filename: 'test.txt',
      contentType: 'text/plain',
      length: 1024,
      metadata: {
        boardId: 'test-board',
        cardId: 'test-card'
      }
    };

    // 각 테스트 전에 실행
    beforeEach(() => {
      // 테스트용 파일 생성
      Attachments.insert(testFile);
    });

    // 각 테스트 후에 실행
    afterEach(() => {
      // 테스트용 파일 삭제
      Attachments.remove({ _id: testFile._id });
      testBucket.delete(testFile._id);
    });

    // 단일 파일 GridFS 이동 테스트
    it('단일 파일을 GridFS로 이동', async () => {
      const result = await Meteor.call('moveFileToGridFS', testFile._id);
      expect(result.success).toBe(true);

      // GridFS에 파일이 있는지 확인
      const file = await testBucket.find({ _id: testFile._id }).toArray();
      expect(file.length).toBe(1);
      expect(file[0].filename).toBe(testFile.filename);
    });

    // 모든 파일 GridFS 이동 테스트
    it('모든 파일을 GridFS로 이동', async () => {
      const result = await Meteor.call('moveAllFilesToGridFS');
      expect(result.success).toBe(true);
      expect(result.details.length).toBeGreaterThan(0);
    });

    // GridFS 파일 삭제 테스트
    it('GridFS에서 파일 삭제', async () => {
      // 먼저 파일을 GridFS로 이동
      await Meteor.call('moveFileToGridFS', testFile._id);

      // 파일 삭제
      const result = await Meteor.call('removeFileFromGridFS', testFile._id);
      expect(result.success).toBe(true);

      // 파일이 삭제되었는지 확인
      const file = await testBucket.find({ _id: testFile._id }).toArray();
      expect(file.length).toBe(0);
    });

    // GridFS 파일 정보 조회 테스트
    it('GridFS 파일 정보 조회', async () => {
      // 먼저 파일을 GridFS로 이동
      await Meteor.call('moveFileToGridFS', testFile._id);

      // 파일 정보 조회
      const result = await Meteor.call('getGridFSFileInfo', testFile._id);
      expect(result.success).toBe(true);
      expect(result.fileInfo.id).toBe(testFile._id);
      expect(result.fileInfo.filename).toBe(testFile.filename);
    });

    // 권한 테스트
    it('권한이 없는 경우 에러 발생', async () => {
      // Meteor.userId를 null로 설정하여 권한 없는 상태 시뮬레이션
      const originalUserId = Meteor.userId;
      Meteor.userId = () => null;

      try {
        await Meteor.call('moveFileToGridFS', testFile._id);
        fail('권한 에러가 발생해야 합니다');
      } catch (error) {
        expect(error.error).toBe('not-authorized');
      } finally {
        // 원래 상태로 복구
        Meteor.userId = originalUserId;
      }
    });

    // 파일 업로드 테스트
    it('새 파일 업로드 시 GridFS에 저장', async () => {
      const newFile = {
        _id: 'new-file-id',
        filename: 'new.txt',
        contentType: 'text/plain',
        length: 2048,
        metadata: {
          boardId: 'test-board',
          cardId: 'test-card'
        }
      };

      // 파일 업로드 시뮬레이션
      Attachments.insert(newFile);
      await Meteor.call('moveFileToGridFS', newFile._id);

      // GridFS에 저장되었는지 확인
      const file = await testBucket.find({ _id: newFile._id }).toArray();
      expect(file.length).toBe(1);
      expect(file[0].filename).toBe(newFile.filename);

      // 테스트 후 정리
      Attachments.remove({ _id: newFile._id });
      testBucket.delete(newFile._id);
    });
  });
}
