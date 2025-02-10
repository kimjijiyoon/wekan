import { Mongo } from 'meteor/mongo';
import { HTTP } from 'meteor/http';
import { ReactiveCache } from '/imports/reactiveCache';
import { TAPi18n } from '/imports/i18n';

if (Meteor.isServer) {
  Meteor.startup(() => {
    console.log("[초기화] 카드 이동 감지 준비 중...");

    const boardStartLists = {};

    // "시작" 리스트 관찰 및 업데이트 함수
    const updateStartListId = (boardId) => {
      console.log(`[디버깅] 보드(${boardId})의 "시작" 리스트를 초기화 중...`);
      const startList = Lists.findOne({ boardId, title: '시작' });
      if (startList) {
        boardStartLists[boardId] = startList._id;
        console.log(`[초기화] 보드(${boardId})의 "시작" 리스트 ID: ${startList._id}`);
      } else {
        boardStartLists[boardId] = null;
        console.log(`[알림] 보드(${boardId})의 "시작" 리스트가 아직 생성되지 않았습니다.`);
      }
    };

    // "시작" 리스트 감지 설정
    const listsCursor = Lists.find({ title: '시작' });
    listsCursor.observeChanges({
      added(id, fields) {
        console.log(`[감지됨] "시작" 리스트 생성됨: ${id}`);
        if (fields.boardId) {
          boardStartLists[fields.boardId] = id;
        }
      },
      removed(id) {
        console.log(`[감지됨] "시작" 리스트 삭제됨: ${id}`);
        Object.keys(boardStartLists).forEach(boardId => {
          if (boardStartLists[boardId] === id) {
            boardStartLists[boardId] = null;
          }
        });
      },
    });

    // 모든 보드의 "시작" 리스트 초기화
    const boards = Boards.find({}).fetch();
    boards.forEach(board => updateStartListId(board._id));

    Meteor.setTimeout(() => {
      boards.forEach(board => {
        if (!boardStartLists[board._id]) {
          console.warn(`[재검사] 보드(${board._id})의 "시작" 리스트를 다시 확인합니다.`);
          updateStartListId(board._id);
        }
      });
    }, 5000);

    // 라벨 ID를 라벨명으로 변환하는 함수
    const getLabelNames = (labelIds) => {
      if (!labelIds || labelIds.length === 0) return [];

      // 카드가 속한 보드 가져오기
      const card = ReactiveCache.getCard({ labelIds: { $in: labelIds } });
      if (!card) return [];

      const board = ReactiveCache.getBoard(card.boardId);
      if (!board) return [];

      return labelIds
        .map(labelId => {
          const label = board.getLabelById(labelId);
          return label ? label.name : null;
        })
        .filter(labelName => labelName);
    };

    // 카드 변경 감지 설정
    const cardsCursor = Cards.find({}, { fields: { listId: 1, title: 1, boardId: 1, description: 1, labelIds: 1, userId: 1, hasBeenHooked: 1 , customFields: 1 , members: 1, assignees: 1 , receivedAt: 1, startAt: 1, dueAt: 1, endAt: 1  } });
    cardsCursor.observeChanges({
      changed(id, fields) {
        const card = Cards.findOne(
          { _id: id },
          {
            fields: {
              boardId: 1,
              listId: 1,
              title: 1,
              description: 1,
              labelIds: 1,
              userId: 1,
              hasBeenHooked: 1,
              customFields: 1,
              members: 1,      // members 필드 추가
              assignees: 1,
              receivedAt: 1,    // Received 날짜
              startAt: 1,       // Start 날짜
              dueAt: 1,         // Due 날짜
              endAt: 1          // End 날짜 (있는 경우)
            }
          }
        );

        // 모든 필드를 가져오기
        const card2 = Cards.findOne({ _id: id });

        // console.log('[카드 전체 구조]', {
        //   availableFields: Object.keys(card2 || {}),
        //   fullCardData: card2,
        // });

        if (!card || !card.boardId) {
          console.warn(`[경고] 카드(${id})의 boardId를 찾을 수 없습니다.`);
          return;
        }

        // 멤버와 담당자 정보 가져오기
        const members = card.members ? card.members.map(memberId => {
          const user = ReactiveCache.getUser(memberId);
          return user ? user.username : null;
        }).filter(Boolean) : [];

        const assignees = card.assignees ? card.assignees.map(assigneeId => {
          const user = ReactiveCache.getUser(assigneeId);
          return user ? user.username : null;
        }).filter(Boolean) : [];

        // 리스트 이름 가져오기
        const list = Lists.findOne({ _id: card.listId });
        const listName = list ? list.title : null;

        // 라벨 이름 가져오기
        const labels = getLabelNames(card.labelIds);

        // 사용자 정보 가져오기
        const user = Users.findOne({ _id: card.userId });
        const userName = user ? user.username : 'Unknown';

        console.log(`[감지됨] 카드(${id}) 변경됨:`, fields);

        if (card.listId === boardStartLists[card.boardId]) {
          const existingCard = Cards.findOne(
            {
              _id: card._id,
              $or: [
                { hasBeenHooked: true },
                { hasBeenHooked: { $exists: true, $eq: true } }
              ]
            }
          );

          if (existingCard) {
            console.log(`[무시됨] 카드(${id})는 이미 이전에 훅이 실행되었습니다.`);
          } else {
            console.log(`[감지됨] 카드(${id})가 "시작" 리스트로 이동되었습니다.`);

            try {
              Cards.update(
                { _id: card._id },
                {
                  $set: {
                    hasBeenHooked: true,
                    modifiedAt: new Date()
                  }
                }
              );

              const integration = ReactiveCache.getIntegration({ boardId: card.boardId });
              const webhookUrl = integration ? integration.url : null;

              if (webhookUrl) {
                const customFieldsData = {};
                if (card.customFields) {
                  card.customFields.forEach(field => {
                    const definition = ReactiveCache.getCustomField(field._id);

                    if (definition) {
                      customFieldsData[definition.name] = Array.isArray(field.value) ?
                      JSON.stringify(field.value, null) : field.value;
                    }
                  });
                }

                console.log('[수집된 커스텀 필드 데이터]',  JSON.stringify(customFieldsData, null));

                const payload = {
                  event: 'cardMovedToStart',
                  card: {
                    id: card._id,
                    title: card.title,
                    description: card.description || null,
                    listName: listName || null,
                    labels: labels.length > 0 ? labels : null,
                    user: userName || null,
                    customFields: Object.keys(customFieldsData).length > 0 ?
                      JSON.parse(JSON.stringify(customFieldsData)) : null,  // 깊은 복사를 통해 전체 데이터 유지
                    members: members.length > 0 ? members : null,       // members 추가
                    assignees: assignees.length > 0 ? assignees : null,  // assignees 추가
                    dates: {
                      received: card.receivedAt || null,
                      start: card.startAt || null,
                      due: card.dueAt || null,
                      end: card.endAt || null
                    }
                  },
                };

                console.log(`[디버깅] 웹훅으로 전송할 데이터:`, payload);

                HTTP.post(webhookUrl, { data: payload }, (err, res) => {
                  if (err) {
                    console.error(`[Webhook 실패] 카드(${id}):`, err);
                  } else {
                    console.log(`[Webhook 성공] 카드(${id}):`, res);
                  }
                });
              } else {
                console.warn(`[경고] 보드(${card.boardId})의 웹훅 URL을 찾을 수 없습니다.`);
              }
            } catch (error) {
              console.error(`[오류] 카드 상태 업데이트 실패:`, error);
              return;
            }
          }
        } else {
          console.log(`[무시됨] 카드(${id})는 "시작" 리스트로 이동하지 않았습니다.`);
        }
      },
    });
  });
}

