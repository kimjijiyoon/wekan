import { ReactiveCache } from '/imports/reactiveCache';
import { TAPi18n } from '/imports/i18n';
import { CardTemplates } from '/models/cardTemplates';

Sidebar = null;

const defaultView = 'home';
const MCB = '.materialCheckBox';
const CKCLS = 'is-checked';

const viewTitles = {
  filter: 'filter-cards',
  search: 'search-cards',
  multiselection: 'multi-selection',
  customFields: 'custom-fields',
  archives: 'archives',
  cardTemplates : 'card-templates',
};

BlazeComponent.extendComponent({
  mixins() {
    return [Mixins.InfiniteScrolling];
  },

  onCreated() {
    this._isOpen = new ReactiveVar(false);
    this._view = new ReactiveVar(defaultView);
    this._hideCardCounterList = new ReactiveVar(false);
    this._hideBoardMemberList = new ReactiveVar(false);
    Sidebar = this;
  },

  onDestroyed() {
    Sidebar = null;
  },

  isOpen() {
    return this._isOpen.get();
  },

  open() {
    if (!this._isOpen.get()) {
      this._isOpen.set(true);
      EscapeActions.executeUpTo('detailsPane');
    }
  },

  hide() {
    if (this._isOpen.get()) {
      this._isOpen.set(false);
    }
  },

  toggle() {
    this._isOpen.set(!this._isOpen.get());
  },

  calculateNextPeak() {
    const sidebarElement = this.find('.js-board-sidebar-content');
    if (sidebarElement) {
      const altitude = sidebarElement.scrollHeight;
      this.callFirstWith(this, 'setNextPeak', altitude);
    }
  },

  reachNextPeak() {
    const activitiesComponent = this.childComponents('activities')[0];
    activitiesComponent.loadNextPage();
  },

  isTongueHidden() {
    return this.isOpen() && this.getView() !== defaultView;
  },

  scrollTop() {
    this.$('.js-board-sidebar-content').scrollTop(0);
  },

  getView() {
    return this._view.get();
  },

  setView(view) {
    view = _.isString(view) ? view : defaultView;
    if (this._view.get() !== view) {
      this._view.set(view);
      this.scrollTop();
      EscapeActions.executeUpTo('detailsPane');
    }
    this.open();
  },

  isDefaultView() {
    return this.getView() === defaultView;
  },

  getViewTemplate() {
    return `${this.getView()}Sidebar`;
  },

  getViewTitle() {
    return TAPi18n.__(viewTitles[this.getView()]);
  },

  showTongueTitle() {
    if (this.isOpen()) return `${TAPi18n.__('sidebar-close')}`;
    else return `${TAPi18n.__('sidebar-open')}`;
  },

  isKeyboardShortcuts() {
    const user = ReactiveCache.getCurrentUser();
    return user && user.isKeyboardShortcuts();
  },

  isVerticalScrollbars() {
    const user = ReactiveCache.getCurrentUser();
    return user && user.isVerticalScrollbars();
  },

  events() {
    return [
      {
        'click .js-hide-sidebar': this.hide,
        'click .js-toggle-sidebar': this.toggle,
        'click .js-back-home': this.setView,
        'click .js-toggle-minicard-label-text'() {
          currentUser = ReactiveCache.getCurrentUser();
          if (currentUser) {
            Meteor.call('toggleMinicardLabelText');
          } else if (window.localStorage.getItem('hiddenMinicardLabelText')) {
            window.localStorage.removeItem('hiddenMinicardLabelText');
            location.reload();
          } else {
            window.localStorage.setItem('hiddenMinicardLabelText', 'true');
            location.reload();
          }
        },
        'click .js-shortcuts'() {
          FlowRouter.go('shortcuts');
        },
        'click .js-keyboard-shortcuts-toggle'() {
          ReactiveCache.getCurrentUser().toggleKeyboardShortcuts();
        },
        'click .js-vertical-scrollbars-toggle'() {
          ReactiveCache.getCurrentUser().toggleVerticalScrollbars();
        },
        'click .js-show-week-of-year-toggle'() {
          ReactiveCache.getCurrentUser().toggleShowWeekOfYear();
        },
        'click .js-close-sidebar'() {
          Sidebar.toggle()
        },
      },
    ];
  },
}).register('sidebar');

Blaze.registerHelper('Sidebar', () => Sidebar);

BlazeComponent.extendComponent({
  onCreated() {
    console.log('팝업 생성중');
    this.autorun(() => {
      const boardId = Session.get('currentBoard');
      this.subscribe('board', boardId, false);
    });

    this.page = new ReactiveVar(1);
    this.loadingMore = new ReactiveVar(false);
    this.reachedEnd = new ReactiveVar(false);

    // 기존 스크롤 이벤트 제거 및 스크롤 방지
    $('.board-sidebar').css('overflow', 'hidden');
  },

  onRendered() {
  },

  onDestroyed() {
    // 팝업이 닫힐 때 스크롤 복원
    $('.board-sidebar').css('overflow', '');
  },

  templateTitle() {
    const templateId = Session.get('selectedTemplateId');
    const template = ApiTemplates.findOne(templateId);
    return template ? template.title : '';
  },

  swimlanes() {
    const boardId = Session.get('currentBoard');
    return Swimlanes.find({ boardId }, { sort: { sort: 1 } });
  },

  lists() {
    const boardId = Session.get('currentBoard');
    return Lists.find({ boardId }, { sort: { sort: 1 } });
  },

}).register('selectListPopup');

Template.selectListPopup.events({
  'submit form'(evt, tpl) {
    console.log('서브밋 버튼 클릭');
    evt.preventDefault();
    console.log('카드 생성 클릭 이벤트');
    const templateId = Session.get('selectedTemplateId');
    const template = ApiTemplates.findOne(templateId);
    const parentId = Session.get('selectedParentId');
    const parentTemplate = CardTemplates.findOne(parentId);

    if (!template || !parentTemplate || !parentTemplate.enabled) {
      return;
    }

    const boardId = Session.get('currentBoard');
    const swimlaneId = tpl.$('.js-select-swimlane').val();
    const listId = tpl.$('.js-select-list').val();
    const cardTitle = tpl.$('.js-card-title').val().trim();

    if (!cardTitle) {
      return;
    }

    // sort 값 계산 수정
    const sort = Cards.find({ listId: listId }).count();
    // 보드의 커스텀 필드 가져오기
    const customFieldsArr = [];
    ReactiveCache.getCustomFields({ 'boardIds': boardId }).forEach(field => {
      if (field.automaticallyOnCard || field.alwaysOnCard) {
        // apiDropdown 타입인 경우 빈 배열로 초기화
        const initialValue = field.type === 'apiDropdown' ? [] : null;
        customFieldsArr.push({
          _id: field._id,
          value: initialValue
        });
      }
    });

    // 카드 생성
    let description = template.description;
    if (description && description.includes('createTime:')) {
      const now = new Date();
      const pad = n => n < 10 ? '0' + n : n;
      const formattedNow = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      description = description.replace(/createTime:[^\n]*/, `createTime: ${formattedNow}`);
    }
    if (description && description.includes('ScrumId:')) {
      const board = Boards.findOne(boardId);
      const boardTitle = board && board.title; // 또는 .name
      const match = boardTitle.match(/\[([^\]]+)\]/);
      const boardName = match ? match[1] : ""; // 결과: "프로젝트A"
      description = description.replace(/createTime:[^\n]*/, `createTime: ${boardName}`);
    }
    // 카드 생성
    Cards.insert({
      title: cardTitle,
      description: description,
      listId: listId,
      boardId: boardId,
      swimlaneId: swimlaneId,
      userId: Meteor.userId(),
      sort: sort,  // 수정된 sort 값 사용
      createdAt: new Date(),
      customFields: customFieldsArr,  // 커스텀 필드 추가
    }, (error, newCardId) => {  // cardId를 받아옴
      if (error) {
        console.error('카드 생성 실패:', error);
      } else {
        console.log('카드 생성 성공');
        // 활동 기록은 서버 메서드로 처리
        Meteor.call('createCardActivity', {
          cardId: newCardId,
          boardId: boardId,
          listId: listId,
          swimlaneId: swimlaneId,
          cardTitle: template.title
        });
        Popup.close();
      }
    });
  },

  'click .js-close'(evt) {
    evt.preventDefault();
    Popup.close();
  }
});


BlazeComponent.extendComponent({
  boardId() {
    return Session.get('currentBoard');
  },

  hasApiTemplates(templateId) {
    console.log('현재 템플릿 ID:', templateId);
    const count = ApiTemplates.find({ parentTemplateId: templateId }).count();
    console.log('API 템플릿 수:', count);
    return count > 0;
  },

  apiTemplatesForParent(templateId) {
    const parentTemplate = CardTemplates.findOne(templateId);
    return ApiTemplates.find(
      { parentTemplateId: templateId },
      { sort: { createdAt: -1 } }
    ).map(template => ({
      ...template,
      truncatedDescription: this.getTruncatedDescription(template.description),
      parentEnabled: parentTemplate ? parentTemplate.enabled : false
    }));
  },

  templates() {
    const boardId = this.boardId();
    const templates = CardTemplates.find(
      { boardId: boardId },
      { sort: { createdAt: -1 } }
    ).fetch();

    console.log('현재 템플릿 데이터:', templates);  // 디버깅용

    return templates.map(template => ({
      _id: template._id,
      title: template.title || '',
      url: template.url || '',
      description: template.description || '',
      enabled: template.enabled,
      boardId: template.boardId
    }));
  },

  apiTemplates() {
    const templates = ApiTemplates.find(
      { boardId: this.boardId() },
      { sort: { createdAt: -1 } }
    ).fetch();

    // 각 API 템플릿에 부모 템플릿의 enabled 상태 추가
    return templates.map(template => {
      const parentTemplate = CardTemplates.findOne(template.parentTemplateId);
      return {
        ...template,
        truncatedDescription: this.getTruncatedDescription(template.description),
        parentEnabled: parentTemplate ? parentTemplate.enabled : false
      };
    });
  },

  getTruncatedDescription(description) {
    const text = description || '';
    const maxLength = 50;

    if (text.length > maxLength) {
      return text.substring(0, maxLength) + '...';
    }
    return text;
  },

  onCreated() {
    this.autorun(() => {
      this.disabledStates = new ReactiveDict();
      const boardId = this.boardId();
      const templatesHandle = this.subscribe('cardTemplates', boardId);

      if (templatesHandle.ready()) {
        console.log('템플릿 구독 완료');
        const templates = CardTemplates.find({ boardId: boardId }).fetch();
        // 각 템플릿의 초기 상태 설정
        templates.forEach(template => {
          this.disabledStates.set(template._id, !template.enabled);
        });
        console.log('로드된 템플릿:', templates);
      }
    });
  },

  events() {
    return [{
      'click .template-item .js-use-template'(evt) {
        evt.preventDefault();
        evt.stopPropagation();  // 이벤트 전파 중지

        console.log('템플릿 사용 버튼 클릭됨');

        try {
          const templateId = $(evt.currentTarget).data('template-id');
          const parentId = $(evt.currentTarget).data('parent-id');

          console.log('템플릿 선택:', templateId, parentId);

          Session.set('selectedTemplateId', templateId);
          Session.set('selectedParentId', parentId);

          const template = ApiTemplates.findOne(templateId);
          if (!template) {
            console.error('API 템플릿을 찾을 수 없습니다');
            return;
          }

          const parentTemplate = CardTemplates.findOne(parentId);
          if (!parentTemplate || !parentTemplate.enabled) {
            console.log('부모 템플릿 비활성화 또는 없음');
            return;
          }

           // 스크롤 방지 추가
          $('.board-sidebar').css('overflow', 'hidden');

          // Popup.open()이 반환하는 함수를 즉시 실행
          const openPopup = Popup.open('selectList');
          openPopup.call(this, evt, {
            dataContextIfCurrentDataIsUndefined: {
              templateId,
              parentId
            }
          });

        } catch (error) {
          console.error('템플릿 사용 중 오류:', error);
          // 에러 발생 시 스크롤 상태 복원
          $('.board-sidebar').css('overflow', '');
        }
      },

      'click a.flex'(evt) {
        evt.preventDefault();
        const templateId = $(evt.target).closest('form').find('input[name="id"]').val();
        const currentState = this.disabledStates.get(templateId);
        this.disabledStates.set(templateId, !currentState);
        $(evt.target).toggleClass(CKCLS, !currentState);
      },

      submit(evt) {
        evt.preventDefault();
        const title = evt.target.title.value;
        const url = evt.target.url.value;
        const description = evt.target.description.value;
        const boardId = this.boardId();
        const templateId = evt.target.id.value;

        if (templateId) {
          const enabled = !this.disabledStates.get(templateId);
          const oldTemplate = CardTemplates.findOne(templateId);

          console.log('템플릿 수정:', {
            templateId,
            title,
            url,
            description,
            enabled
          });

          CardTemplates.update(templateId, {
            $set: {
              title,
              url,
              description,
              modifiedAt: new Date(),
              enabled
            }
          }, (error) => {
            if (error) {
              console.error('템플릿 수정 실패:', error);
              alert('템플릿 저장에 실패했습니다.');
            } else {
              console.log('템플릿 수정 성공');
              alert('템플릿이 저장되었습니다.');

              // 서버 메서드 호출
              Meteor.call('updateApiTemplates', {
                parentTemplateId: templateId,
                url: url,
                boardId: oldTemplate.boardId
              }, (error) => {
                if (error) {
                  console.error('API 템플릿 업데이트 실패:', error);
                  alert('API 템플릿 업데이트에 실패했습니다.');
                } else {
                  console.log('API 템플릿 업데이트 성공');
                  alert('API 템플릿이 업데이트되었습니다.');
                }
              });
            }
          });
        }
        // 새 템플릿 생성
        else {
          CardTemplates.insert({
            title,
            url,
            description,
            boardId,
            userId: Meteor.userId(),
            createdAt: new Date(),
            enabled: true
          }, (error, newTemplateId) => {
            if (!error && url) {
              // API에서 템플릿 데이터 가져오기
              fetch(url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                mode: 'cors'
              })
              .then(response => response.json())
              .then(data => {
                data.forEach(template => {
                  ApiTemplates.insert({
                    parentTemplateId: newTemplateId,
                    title: template.title,
                    description: template.description,
                    boardId,
                    userId: Meteor.userId(),
                    createdAt: new Date(),
                    enabled: true
                  });
                });
                alert('새 템플릿이 생성되었습니다.');
              })
              .catch(error => {
                console.error('템플릿 가져오기 실패:', error);
                alert('API 템플릿 가져오기에 실패했습니다.');
              });
            } else {
              console.error('템플릿 생성 실패:', error);
              alert('템플릿 생성에 실패했습니다.');
            }
          });
          evt.target.reset();
        }
      },
    }];
  },
}).register('cardTemplatesSidebar');

BlazeComponent.extendComponent({
  hiddenMinicardLabelText() {
    currentUser = ReactiveCache.getCurrentUser();
    if (currentUser) {
      return (currentUser.profile || {}).hiddenMinicardLabelText;
    } else if (window.localStorage.getItem('hiddenMinicardLabelText')) {
      return true;
    } else {
      return false;
    }
  },
  isVerticalScrollbars() {
    const user = ReactiveCache.getCurrentUser();
    return user && user.isVerticalScrollbars();
  },
  isShowWeekOfYear() {
    const user = ReactiveCache.getCurrentUser();
    return user && user.isShowWeekOfYear();
  },
  showActivities() {
    let ret = Utils.getCurrentBoard().showActivities ?? false;
    return ret;
  },
  events() {
    return [
      {
        'click #toggleShowActivitiesBoard'() {
          Utils.getCurrentBoard().toggleShowActivities();
        },
      },
    ];
  },
}).register('homeSidebar');

Template.boardInfoOnMyBoardsPopup.helpers({
  hideCardCounterList() {
    return Utils.isMiniScreen() && Session.get('currentBoard');
  },
  hideBoardMemberList() {
    return Utils.isMiniScreen() && Session.get('currentBoard');
  },
});

EscapeActions.register(
  'sidebarView',
  () => {
    Sidebar.setView(defaultView);
  },
  () => {
    return Sidebar && Sidebar.getView() !== defaultView;
  },
);

Template.memberPopup.helpers({
  user() {
    return ReactiveCache.getUser(this.userId);
  },
  isBoardAdmin() {
    return ReactiveCache.getCurrentUser().isBoardAdmin();
  },
  memberType() {
    const type = ReactiveCache.getUser(this.userId).isBoardAdmin() ? 'admin' : 'normal';
    if (type === 'normal') {
      const currentBoard = Utils.getCurrentBoard();
      const commentOnly = currentBoard.hasCommentOnly(this.userId);
      const noComments = currentBoard.hasNoComments(this.userId);
      const worker = currentBoard.hasWorker(this.userId);
      if (commentOnly) {
        return TAPi18n.__('comment-only');
      } else if (noComments) {
        return TAPi18n.__('no-comments');
      } else if (worker) {
        return TAPi18n.__('worker');
      } else {
        return TAPi18n.__(type);
      }
    } else {
      return TAPi18n.__(type);
    }
  },
  isInvited() {
    return ReactiveCache.getUser(this.userId).isInvitedTo(Session.get('currentBoard'));
  },
});


Template.boardMenuPopup.events({
  'click .js-rename-board': Popup.open('boardChangeTitle'),
  'click .js-open-rules-view'() {
    Modal.openWide('rulesMain');
    Popup.back();
  },
  'click .js-custom-fields'() {
    Sidebar.setView('customFields');
    Popup.back();
  },
  'click .js-open-archives'() {
    Sidebar.setView('archives');
    Popup.back();
  },
  'click .js-change-board-color': Popup.open('boardChangeColor'),
  'click .js-change-background-image': Popup.open('boardChangeBackgroundImage'),
  'click .js-board-info-on-my-boards': Popup.open('boardInfoOnMyBoards'),
  'click .js-change-language': Popup.open('changeLanguage'),
  'click .js-archive-board ': Popup.afterConfirm('archiveBoard', function() {
    const currentBoard = Utils.getCurrentBoard();
    currentBoard.archive();
    // XXX We should have some kind of notification on top of the page to
    // confirm that the board was successfully archived.
    FlowRouter.go('home');
  }),
  'click .js-delete-board': Popup.afterConfirm('deleteBoard', function() {
    const currentBoard = Utils.getCurrentBoard();
    Popup.back();
    Boards.remove(currentBoard._id);
    FlowRouter.go('home');
  }),
  'click .js-outgoing-webhooks': Popup.open('outgoingWebhooks'),
  'click .js-import-board': Popup.open('chooseBoardSource'),
  'click .js-subtask-settings': Popup.open('boardSubtaskSettings'),
  'click .js-card-settings': Popup.open('boardCardSettings'),
  // 'click .js-card-templates': Popup.open('cardTemplates'),
  'click .js-export-board': Popup.open('exportBoard'),
});

Template.boardMenuPopup.onCreated(function() {
  this.apiEnabled = new ReactiveVar(false);
  Meteor.call('_isApiEnabled', (e, result) => {
    this.apiEnabled.set(result);
  });
});

Template.boardMenuPopup.helpers({
  isBoardAdmin() {
    return ReactiveCache.getCurrentUser().isBoardAdmin();
  },
  withApi() {
    return Template.instance().apiEnabled.get();
  },
  exportUrl() {
    const params = {
      boardId: Session.get('currentBoard'),
    };
    const queryParams = {
      authToken: Accounts._storedLoginToken(),
    };
    return FlowRouter.path('/api/boards/:boardId/export', params, queryParams);
  },
  exportFilename() {
    const boardId = Session.get('currentBoard');
    return `export-board-${boardId}.json`;
  },
});

Template.memberPopup.events({
  'click .js-filter-member'() {
    Filter.members.toggle(this.userId);
    Popup.back();
  },
  'click .js-change-role': Popup.open('changePermissions'),
  'click .js-remove-member': Popup.afterConfirm('removeMember', function() {
    // This works from removing member from board, card members and assignees.
    const boardId = Session.get('currentBoard');
    const memberId = this.userId;
    ReactiveCache.getCards({ boardId, members: memberId }).forEach(card => {
      card.unassignMember(memberId);
    });
    ReactiveCache.getCards({ boardId, assignees: memberId }).forEach(card => {
      card.unassignAssignee(memberId);
    });
    ReactiveCache.getBoard(boardId).removeMember(memberId);
    Popup.back();
  }),
  'click .js-leave-member': Popup.afterConfirm('leaveBoard', () => {
    const boardId = Session.get('currentBoard');
    Meteor.call('quitBoard', boardId, () => {
      Popup.back();
      FlowRouter.go('home');
    });
  }),
});

Template.removeMemberPopup.helpers({
  user() {
    return ReactiveCache.getUser(this.userId);
  },
  board() {
    return Utils.getCurrentBoard();
  },
});

Template.leaveBoardPopup.helpers({
  board() {
    return Utils.getCurrentBoard();
  },
});
BlazeComponent.extendComponent({
  onCreated() {
    this.error = new ReactiveVar('');
    this.loading = new ReactiveVar(false);
    this.findOrgsOptions = new ReactiveVar({});
    this.findTeamsOptions = new ReactiveVar({});

    this.page = new ReactiveVar(1);
    this.teamPage = new ReactiveVar(1);
    this.autorun(() => {
      const limitOrgs = this.page.get() * Number.MAX_SAFE_INTEGER;
      this.subscribe('org', this.findOrgsOptions.get(), limitOrgs, () => {});
    });

    this.autorun(() => {
      const limitTeams = this.teamPage.get() * Number.MAX_SAFE_INTEGER;
      this.subscribe('team', this.findTeamsOptions.get(), limitTeams, () => {});
    });
  },

  onRendered() {
    this.setLoading(false);
  },

  setError(error) {
    this.error.set(error);
  },

  setLoading(w) {
    this.loading.set(w);
  },

  isLoading() {
    return this.loading.get();
  },

  tabs() {
    return [
      { name: TAPi18n.__('people'), slug: 'people' },
      { name: TAPi18n.__('organizations'), slug: 'organizations' },
      { name: TAPi18n.__('teams'), slug: 'teams' },
    ];
  },
}).register('membersWidget');

Template.membersWidget.helpers({
  isInvited() {
    const user = ReactiveCache.getCurrentUser();
    return user && user.isInvitedTo(Session.get('currentBoard'));
  },
  isWorker() {
    const user = ReactiveCache.getCurrentUser();
    if (user) {
      return Meteor.call(Boards.hasWorker(user.memberId));
    } else {
      return false;
    }
  },
  isBoardAdmin() {
    return ReactiveCache.getCurrentUser().isBoardAdmin();
  },
  AtLeastOneOrgWasCreated(){
    let orgs = ReactiveCache.getOrgs({}, {sort: { createdAt: -1 }});
    if(orgs === undefined)
      return false;

    return orgs.length > 0;
  },

  AtLeastOneTeamWasCreated(){
    let teams = ReactiveCache.getTeams({}, {sort: { createdAt: -1 }});
    if(teams === undefined)
      return false;

    return teams.length > 0;
  },
});

Template.membersWidget.events({
  'click .js-member': Popup.open('member'),
  'click .js-open-board-menu': Popup.open('boardMenu'),
  'click .js-manage-board-members': Popup.open('addMember'),
  'click .js-manage-board-addOrg': Popup.open('addBoardOrg'),
  'click .js-manage-board-addTeam': Popup.open('addBoardTeam'),
  'click .js-import': Popup.open('boardImportBoard'),
  submit: this.onSubmit,
  'click .js-import-board': Popup.open('chooseBoardSource'),
  'click .js-open-archived-board'() {
    Modal.open('archivedBoards');
  },
  'click .sandstorm-powerbox-request-identity'() {
    window.sandstormRequestIdentity();
  },
  'click .js-member-invite-accept'() {
    const boardId = Session.get('currentBoard');
    ReactiveCache.getCurrentUser().removeInvite(boardId);
  },
  'click .js-member-invite-decline'() {
    const boardId = Session.get('currentBoard');
    Meteor.call('quitBoard', boardId, (err, ret) => {
      if (!err && ret) {
        ReactiveCache.getCurrentUser().removeInvite(boardId);
        FlowRouter.go('home');
      }
    });
  },
});

BlazeComponent.extendComponent({
  boardId() {
    return Session.get('currentBoard') || Integrations.Const.GLOBAL_WEBHOOK_ID;
  },
  integrations() {
    const boardId = this.boardId();
    const ret = ReactiveCache.getIntegrations({ boardId });
    return ret;
  },
  types() {
    return Integrations.Const.WEBHOOK_TYPES;
  },
  integration(cond) {
    const boardId = this.boardId();
    const condition = { boardId, ...cond };
    for (const k in condition) {
      if (!condition[k]) delete condition[k];
    }
    return ReactiveCache.getIntegration(condition);
  },
  onCreated() {
    this.disabled = new ReactiveVar(false);
  },
  events() {
    return [
      {
        'click a.flex'(evt) {
          this.disabled.set(!this.disabled.get());
          $(evt.target).toggleClass(CKCLS, this.disabled.get());
        },
        submit(evt) {
          evt.preventDefault();
          const url = evt.target.url.value;
          const boardId = this.boardId();
          let id = null;
          let integration = null;
          const title = evt.target.title.value;
          const token = evt.target.token.value;
          const type = evt.target.type.value;
          const enabled = !this.disabled.get();
          let remove = false;
          const values = {
            url,
            type,
            token,
            title,
            enabled,
          };
          if (evt.target.id) {
            id = evt.target.id.value;
            integration = this.integration({ _id: id });
            remove = !url;
          } else if (url) {
            integration = this.integration({ url, token });
          }
          if (remove) {
            Integrations.remove(integration._id);
          } else if (integration && integration._id) {
            Integrations.update(integration._id, {
              $set: values,
            });
          } else if (url) {
            Integrations.insert({
              ...values,
              userId: Meteor.userId(),
              enabled: true,
              boardId,
              activities: ['all'],
            });
          }
          Popup.back();
        },
      },
    ];
  },
}).register('outgoingWebhooksPopup');

BlazeComponent.extendComponent({
  template() {
    return 'chooseBoardSource';
  },
}).register('chooseBoardSourcePopup');

BlazeComponent.extendComponent({
  template() {
    return 'exportBoard';
  },
  withApi() {
    return Template.instance().apiEnabled.get();
  },
  exportUrl() {
    const params = {
      boardId: Session.get('currentBoard'),
    };
    const queryParams = {
      authToken: Accounts._storedLoginToken(),
    };
    return FlowRouter.path('/api/boards/:boardId/export', params, queryParams);
  },
  exportUrlExcel() {
    const params = {
      boardId: Session.get('currentBoard'),
    };
    const queryParams = {
      authToken: Accounts._storedLoginToken(),
    };
    return FlowRouter.path(
      '/api/boards/:boardId/exportExcel',
      params,
      queryParams,
    );
  },
  exportFilenameExcel() {
    const boardId = Session.get('currentBoard');
    return `export-board-excel-${boardId}.xlsx`;
  },
  exportCsvUrl() {
    const params = {
      boardId: Session.get('currentBoard'),
    };
    const queryParams = {
      authToken: Accounts._storedLoginToken(),
      delimiter: ',',
    };
    return FlowRouter.path(
      '/api/boards/:boardId/export/csv',
      params,
      queryParams,
    );
  },
  exportScsvUrl() {
    const params = {
      boardId: Session.get('currentBoard'),
    };
    const queryParams = {
      authToken: Accounts._storedLoginToken(),
      delimiter: ';',
    };
    return FlowRouter.path(
      '/api/boards/:boardId/export/csv',
      params,
      queryParams,
    );
  },
  exportTsvUrl() {
    const params = {
      boardId: Session.get('currentBoard'),
    };
    const queryParams = {
      authToken: Accounts._storedLoginToken(),
      delimiter: '\t',
    };
    return FlowRouter.path(
      '/api/boards/:boardId/export/csv',
      params,
      queryParams,
    );
  },
  exportJsonFilename() {
    const boardId = Session.get('currentBoard');
    return `export-board-${boardId}.json`;
  },
  exportCsvFilename() {
    const boardId = Session.get('currentBoard');
    return `export-board-${boardId}.csv`;
  },
  exportTsvFilename() {
    const boardId = Session.get('currentBoard');
    return `export-board-${boardId}.tsv`;
  },
}).register('exportBoardPopup');

Template.exportBoard.events({
  'click .html-export-board': async event => {
    event.preventDefault();
    await ExportHtml(Popup)();
  },
});

Template.labelsWidget.events({
  'click .js-label': Popup.open('editLabel'),
  'click .js-add-label': Popup.open('createLabel'),
});

Template.labelsWidget.helpers({
  isBoardAdmin() {
    return ReactiveCache.getCurrentUser().isBoardAdmin();
  },
});

// Board members can assign people or labels by drag-dropping elements from the
// sidebar to the cards on the board. In order to re-initialize the jquery-ui
// plugin any time a draggable member or label is modified or removed we use a
// autorun function and register a dependency on the both members and labels
// fields of the current board document.
function draggableMembersLabelsWidgets() {
  this.autorun(() => {
    const currentBoardId = Tracker.nonreactive(() => {
      return Session.get('currentBoard');
    });
    ReactiveCache.getBoard(currentBoardId, {
      fields: {
        members: 1,
        labels: 1,
      },
    });
    Tracker.afterFlush(() => {
      const $draggables = this.$('.js-member,.js-label');
      $draggables.draggable({
        appendTo: 'body',
        helper: 'clone',
        revert: 'invalid',
        revertDuration: 150,
        snap: false,
        snapMode: 'both',
        start() {
          EscapeActions.executeUpTo('popup-back');
        },
      });

      function userIsMember() {
        return ReactiveCache.getCurrentUser()?.isBoardMember();
      }

      this.autorun(() => {
        $draggables.draggable('option', 'disabled', !userIsMember());
      });
    });
  });
}

Template.membersWidget.onRendered(draggableMembersLabelsWidgets);
Template.labelsWidget.onRendered(draggableMembersLabelsWidgets);

BlazeComponent.extendComponent({
  backgroundColors() {
    return Boards.simpleSchema()._schema.color.allowedValues;
  },

  isSelected() {
    const currentBoard = Utils.getCurrentBoard();
    return currentBoard.color === this.currentData().toString();
  },

  events() {
    return [
      {
        'click .js-select-background'(evt) {
          const currentBoard = Utils.getCurrentBoard();
          const newColor = this.currentData().toString();
          currentBoard.setColor(newColor);
          evt.preventDefault();
        },
      },
    ];
  },
}).register('boardChangeColorPopup');

BlazeComponent.extendComponent({
  events() {
    return [
      {
        submit(event) {
          const currentBoard = Utils.getCurrentBoard();
          const backgroundImageURL = this.find('.js-board-background-image-url').value.trim();
          currentBoard.setBackgroundImageURL(backgroundImageURL);
          Utils.setBackgroundImage();
          Popup.back();
          event.preventDefault();
        },
        'click .js-remove-background-image'() {
          const currentBoard = Utils.getCurrentBoard();
          currentBoard.setBackgroundImageURL("");
          Popup.back();
          Utils.reload();
          event.preventDefault();
        },
      },
    ];
  },
}).register('boardChangeBackgroundImagePopup');

Template.boardChangeBackgroundImagePopup.helpers({
  backgroundImageURL() {
    const currentBoard = Utils.getCurrentBoard();
    return currentBoard.backgroundImageURL;
  },
});

BlazeComponent.extendComponent({
  onCreated() {
    this.currentBoard = Utils.getCurrentBoard();
  },

  allowsCardCounterList() {
    return this.currentBoard.allowsCardCounterList;
  },

  allowsBoardMemberList() {
    return this.currentBoard.allowsBoardMemberList;
  },

  events() {
    return [
      {
        'click .js-field-has-cardcounterlist'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsCardCounterList = !this.currentBoard
            .allowsCardCounterList;
            this.currentBoard.setAllowsCardCounterList(
              this.currentBoard.allowsCardCounterList,
          );
          $(`.js-field-has-cardcounterlist ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsCardCounterList,
          );
          $('.js-field-has-cardcounterlist').toggleClass(
            CKCLS,
            this.currentBoard.allowsCardCounterList,
          );
        },
        'click .js-field-has-boardmemberlist'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsBoardMemberList = !this.currentBoard
            .allowsBoardMemberList;
            this.currentBoard.setAllowsBoardMemberList(
              this.currentBoard.allowsBoardMemberList,
          );
          $(`.js-field-has-boardmemberlist ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsBoardMemberList,
          );
          $('.js-field-has-boardmemberlist').toggleClass(
            CKCLS,
            this.currentBoard.allowsBoardMemberList,
          );
        },
      },
    ];
  },
}).register('boardInfoOnMyBoardsPopup');

BlazeComponent.extendComponent({
  onCreated() {
    this.currentBoard = Utils.getCurrentBoard();
  },

  allowsSubtasks() {
    return this.currentBoard.allowsSubtasks;
  },

  allowsReceivedDate() {
    return this.currentBoard.allowsReceivedDate;
  },

  isBoardSelected() {
    return this.currentBoard.subtasksDefaultBoardId === this.currentData()._id;
  },

  isNullBoardSelected() {
    return (
      this.currentBoard.subtasksDefaultBoardId === null ||
      this.currentBoard.subtasksDefaultBoardId === undefined
    );
  },

  boards() {
    const ret = ReactiveCache.getBoards(
      {
        archived: false,
        'members.userId': Meteor.userId(),
      },
      {
        sort: { sort: 1 /* boards default sorting */ },
      },
    );
    return ret;
  },

  lists() {
    return ReactiveCache.getLists(
      {
        boardId: this.currentBoard._id,
        archived: false,
      },
      {
        sort: ['title'],
      },
    );
  },

  hasLists() {
    return this.lists().length > 0;
  },

  isListSelected() {
    return this.currentBoard.subtasksDefaultBoardId === this.currentData()._id;
  },

  presentParentTask() {
    let result = this.currentBoard.presentParentTask;
    if (result === null || result === undefined) {
      result = 'no-parent';
    }
    return result;
  },

  events() {
    return [
      {
        'click .js-field-has-subtasks'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsSubtasks = !this.currentBoard.allowsSubtasks;
          this.currentBoard.setAllowsSubtasks(this.currentBoard.allowsSubtasks);
          $(`.js-field-has-subtasks ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsSubtasks,
          );
          $('.js-field-has-subtasks').toggleClass(
            CKCLS,
            this.currentBoard.allowsSubtasks,
          );
          $('.js-field-deposit-board').prop(
            'disabled',
            !this.currentBoard.allowsSubtasks,
          );
        },
        'change .js-field-deposit-board'(evt) {
          let value = evt.target.value;
          if (value === 'null') {
            value = null;
          }
          this.currentBoard.setSubtasksDefaultBoardId(value);
          evt.preventDefault();
        },
        'change .js-field-deposit-list'(evt) {
          this.currentBoard.setSubtasksDefaultListId(evt.target.value);
          evt.preventDefault();
        },
        'click .js-field-show-parent-in-minicard'(evt) {
          const value =
            evt.target.id ||
            $(evt.target).parent()[0].id ||
            $(evt.target)
              .parent()[0]
              .parent()[0].id;
          const options = [
            'prefix-with-full-path',
            'prefix-with-parent',
            'subtext-with-full-path',
            'subtext-with-parent',
            'no-parent',
          ];
          options.forEach(function(element) {
            if (element !== value) {
              $(`#${element} ${MCB}`).toggleClass(CKCLS, false);
              $(`#${element}`).toggleClass(CKCLS, false);
            }
          });
          $(`#${value} ${MCB}`).toggleClass(CKCLS, true);
          $(`#${value}`).toggleClass(CKCLS, true);
          this.currentBoard.setPresentParentTask(value);
          evt.preventDefault();
        },
      },
    ];
  },
}).register('boardSubtaskSettingsPopup');

BlazeComponent.extendComponent({
  onCreated() {
    this.currentBoard = Utils.getCurrentBoard();
  },

  allowsReceivedDate() {
    return this.currentBoard.allowsReceivedDate;
  },

  allowsStartDate() {
    return this.currentBoard.allowsStartDate;
  },

  allowsDueDate() {
    return this.currentBoard.allowsDueDate;
  },

  allowsEndDate() {
    return this.currentBoard.allowsEndDate;
  },

  allowsSubtasks() {
    return this.currentBoard.allowsSubtasks;
  },

  allowsCreator() {
    return this.currentBoard.allowsCreator ?? false;
  },

  allowsCreatorOnMinicard() {
    return this.currentBoard.allowsCreatorOnMinicard ?? false;
  },

  allowsMembers() {
    return this.currentBoard.allowsMembers;
  },

  allowsAssignee() {
    return this.currentBoard.allowsAssignee;
  },

  allowsAssignedBy() {
    return this.currentBoard.allowsAssignedBy;
  },

  allowsRequestedBy() {
    return this.currentBoard.allowsRequestedBy;
  },

  allowsCardSortingByNumber() {
    return this.currentBoard.allowsCardSortingByNumber;
  },

  allowsShowLists() {
    return this.currentBoard.allowsShowLists;
  },

  allowsLabels() {
    return this.currentBoard.allowsLabels;
  },

  allowsChecklists() {
    return this.currentBoard.allowsChecklists;
  },

  allowsAttachments() {
    return this.currentBoard.allowsAttachments;
  },

  allowsComments() {
    return this.currentBoard.allowsComments;
  },

  allowsCardNumber() {
    return this.currentBoard.allowsCardNumber;
  },

  allowsDescriptionTitle() {
    return this.currentBoard.allowsDescriptionTitle;
  },

  allowsDescriptionText() {
    return this.currentBoard.allowsDescriptionText;
  },

  isBoardSelected() {
    return this.currentBoard.dateSettingsDefaultBoardID;
  },

  isNullBoardSelected() {
    return (
      this.currentBoard.dateSettingsDefaultBoardId === null ||
      this.currentBoard.dateSettingsDefaultBoardId === undefined
    );
  },

  allowsDescriptionTextOnMinicard() {
    return this.currentBoard.allowsDescriptionTextOnMinicard;
  },

  allowsCoverAttachmentOnMinicard() {
    return this.currentBoard.allowsCoverAttachmentOnMinicard;
  },

  allowsBadgeAttachmentOnMinicard() {
    return this.currentBoard.allowsBadgeAttachmentOnMinicard;
  },

  allowsCardSortingByNumberOnMinicard() {
    return this.currentBoard.allowsCardSortingByNumberOnMinicard;
  },

  boards() {
    const ret = ReactiveCache.getBoards(
      {
        archived: false,
        'members.userId': Meteor.userId(),
      },
      {
        sort: { sort: 1 /* boards default sorting */ },
      },
    );
    return ret;
  },

  lists() {
    return ReactiveCache.getLists(
      {
        boardId: this.currentBoard._id,
        archived: false,
      },
      {
        sort: ['title'],
      },
    );
  },

  hasLists() {
    return this.lists().length > 0;
  },

  isListSelected() {
    return (
      this.currentBoard.dateSettingsDefaultBoardId === this.currentData()._id
    );
  },

  events() {
    return [
      {
        'click .js-field-has-receiveddate'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsReceivedDate = !this.currentBoard
            .allowsReceivedDate;
          this.currentBoard.setAllowsReceivedDate(
            this.currentBoard.allowsReceivedDate,
          );
          $(`.js-field-has-receiveddate ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsReceivedDate,
          );
          $('.js-field-has-receiveddate').toggleClass(
            CKCLS,
            this.currentBoard.allowsReceivedDate,
          );
        },
        'click .js-field-has-startdate'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsStartDate = !this.currentBoard
            .allowsStartDate;
          this.currentBoard.setAllowsStartDate(
            this.currentBoard.allowsStartDate,
          );
          $(`.js-field-has-startdate ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsStartDate,
          );
          $('.js-field-has-startdate').toggleClass(
            CKCLS,
            this.currentBoard.allowsStartDate,
          );
        },
        'click .js-field-has-enddate'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsEndDate = !this.currentBoard.allowsEndDate;
          this.currentBoard.setAllowsEndDate(this.currentBoard.allowsEndDate);
          $(`.js-field-has-enddate ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsEndDate,
          );
          $('.js-field-has-enddate').toggleClass(
            CKCLS,
            this.currentBoard.allowsEndDate,
          );
        },
        'click .js-field-has-duedate'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsDueDate = !this.currentBoard.allowsDueDate;
          this.currentBoard.setAllowsDueDate(this.currentBoard.allowsDueDate);
          $(`.js-field-has-duedate ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsDueDate,
          );
          $('.js-field-has-duedate').toggleClass(
            CKCLS,
            this.currentBoard.allowsDueDate,
          );
        },
        'click .js-field-has-subtasks'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsSubtasks = !this.currentBoard.allowsSubtasks;
          this.currentBoard.setAllowsSubtasks(this.currentBoard.allowsSubtasks);
          $(`.js-field-has-subtasks ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsSubtasks,
          );
          $('.js-field-has-subtasks').toggleClass(
            CKCLS,
            this.currentBoard.allowsSubtasks,
          );
        },
        'click .js-field-has-creator'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsCreator = !this.currentBoard.allowsCreator;
          this.currentBoard.setAllowsCreator(this.currentBoard.allowsCreator);
          $(`.js-field-has-creator ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsCreator,
          );
          $('.js-field-has-creator').toggleClass(
            CKCLS,
            this.currentBoard.allowsCreator,
          );
        },
        'click .js-field-has-creator-on-minicard'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsCreatorOnMinicard = !this.currentBoard.allowsCreatorOnMinicard;
          this.currentBoard.setAllowsCreatorOnMinicard(this.currentBoard.allowsCreatorOnMinicard);
          $(`.js-field-has-creator-on-minicard ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsCreatorOnMinicard,
          );
          $('.js-field-has-creator-on-minicard').toggleClass(
            CKCLS,
            this.currentBoard.allowsCreatorOnMinicard,
          );
        },
        'click .js-field-has-members'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsMembers = !this.currentBoard.allowsMembers;
          this.currentBoard.setAllowsMembers(this.currentBoard.allowsMembers);
          $(`.js-field-has-members ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsMembers,
          );
          $('.js-field-has-members').toggleClass(
            CKCLS,
            this.currentBoard.allowsMembers,
          );
        },
        'click .js-field-has-assignee'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsAssignee = !this.currentBoard.allowsAssignee;
          this.currentBoard.setAllowsAssignee(this.currentBoard.allowsAssignee);
          $(`.js-field-has-assignee ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsAssignee,
          );
          $('.js-field-has-assignee').toggleClass(
            CKCLS,
            this.currentBoard.allowsAssignee,
          );
        },
        'click .js-field-has-assigned-by'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsAssignedBy = !this.currentBoard
            .allowsAssignedBy;
          this.currentBoard.setAllowsAssignedBy(
            this.currentBoard.allowsAssignedBy,
          );
          $(`.js-field-has-assigned-by ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsAssignedBy,
          );
          $('.js-field-has-assigned-by').toggleClass(
            CKCLS,
            this.currentBoard.allowsAssignedBy,
          );
        },
        'click .js-field-has-requested-by'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsRequestedBy = !this.currentBoard
            .allowsRequestedBy;
          this.currentBoard.setAllowsRequestedBy(
            this.currentBoard.allowsRequestedBy,
          );
          $(`.js-field-has-requested-by ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsRequestedBy,
          );
          $('.js-field-has-requested-by').toggleClass(
            CKCLS,
            this.currentBoard.allowsRequestedBy,
          );
        },
        'click .js-field-has-card-sorting-by-number'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsCardSortingByNumber = !this.currentBoard
            .allowsCardSortingByNumber;
          this.currentBoard.setAllowsCardSortingByNumber(
            this.currentBoard.allowsCardSortingByNumber,
          );
          $(`.js-field-has-card-sorting-by-number ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsCardSortingByNumber,
          );
          $('.js-field-has-card-sorting-by-number').toggleClass(
            CKCLS,
            this.currentBoard.allowsCardSortingByNumber,
          );
        },
        'click .js-field-has-card-show-lists'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsShowLists = !this.currentBoard
            .allowsShowLists;
          this.currentBoard.setAllowsShowLists(
            this.currentBoard.allowsShowLists,
          );
          $(`.js-field-has-card-show-lists ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsShowLists,
          );
          $('.js-field-has-card-show-lists').toggleClass(
            CKCLS,
            this.currentBoard.allowsShowLists,
          );
        },
        'click .js-field-has-labels'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsLabels = !this.currentBoard.allowsLabels;
          this.currentBoard.setAllowsLabels(this.currentBoard.allowsLabels);
          $(`.js-field-has-labels ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsAssignee,
          );
          $('.js-field-has-labels').toggleClass(
            CKCLS,
            this.currentBoard.allowsLabels,
          );
        },
        'click .js-field-has-description-title'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsDescriptionTitle = !this.currentBoard
            .allowsDescriptionTitle;
          this.currentBoard.setAllowsDescriptionTitle(
            this.currentBoard.allowsDescriptionTitle,
          );
          $(`.js-field-has-description-title ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsDescriptionTitle,
          );
          $('.js-field-has-description-title').toggleClass(
            CKCLS,
            this.currentBoard.allowsDescriptionTitle,
          );
        },
        'click .js-field-has-card-number'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsCardNumber = !this.currentBoard
            .allowsCardNumber;
          this.currentBoard.setAllowsCardNumber(
            this.currentBoard.allowsCardNumber,
          );
          $(`.js-field-has-card-number ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsCardNumber,
          );
          $('.js-field-has-card-number').toggleClass(
            CKCLS,
            this.currentBoard.allowsCardNumber,
          );
        },
        'click .js-field-has-description-text-on-minicard'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsDescriptionTextOnMinicard = !this.currentBoard
            .allowsDescriptionTextOnMinicard;
          this.currentBoard.setallowsDescriptionTextOnMinicard(
            this.currentBoard.allowsDescriptionTextOnMinicard,
          );
          $(`.js-field-has-description-text-on-minicard ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsDescriptionTextOnMinicard,
          );
          $('.js-field-has-description-text-on-minicard').toggleClass(
            CKCLS,
            this.currentBoard.allowsDescriptionTextOnMinicard,
          );
        },
        'click .js-field-has-description-text'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsDescriptionText = !this.currentBoard
            .allowsDescriptionText;
          this.currentBoard.setAllowsDescriptionText(
            this.currentBoard.allowsDescriptionText,
          );
          $(`.js-field-has-description-text ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsDescriptionText,
          );
          $('.js-field-has-description-text').toggleClass(
            CKCLS,
            this.currentBoard.allowsDescriptionText,
          );
        },
        'click .js-field-has-checklists'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsChecklists = !this.currentBoard
            .allowsChecklists;
          this.currentBoard.setAllowsChecklists(
            this.currentBoard.allowsChecklists,
          );
          $(`.js-field-has-checklists ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsChecklists,
          );
          $('.js-field-has-checklists').toggleClass(
            CKCLS,
            this.currentBoard.allowsChecklists,
          );
        },
        'click .js-field-has-attachments'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsAttachments = !this.currentBoard
            .allowsAttachments;
          this.currentBoard.setAllowsAttachments(
            this.currentBoard.allowsAttachments,
          );
          $(`.js-field-has-attachments ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsAttachments,
          );
          $('.js-field-has-attachments').toggleClass(
            CKCLS,
            this.currentBoard.allowsAttachments,
          );
        },
        'click .js-field-has-comments'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsComments = !this.currentBoard.allowsComments;
          this.currentBoard.setAllowsComments(this.currentBoard.allowsComments);
          $(`.js-field-has-comments ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsComments,
          );
          $('.js-field-has-comments').toggleClass(
            CKCLS,
            this.currentBoard.allowsComments,
          );
        },
        'click .js-field-has-activities'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsActivities = !this.currentBoard
            .allowsActivities;
          this.currentBoard.setAllowsActivities(
            this.currentBoard.allowsActivities,
          );
          $(`.js-field-has-activities ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsActivities,
          );
          $('.js-field-has-activities').toggleClass(
            CKCLS,
            this.currentBoard.allowsActivities,
          );
        },
        'click .js-field-has-cover-attachment-on-minicard'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsCoverAttachmentOnMinicard = !this.currentBoard
            .allowsCoverAttachmentOnMinicard;
          this.currentBoard.setallowsCoverAttachmentOnMinicard(
            this.currentBoard.allowsCoverAttachmentOnMinicard,
          );
          $(`.js-field-has-cover-attachment-on-minicard ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsCoverAttachmentOnMinicard,
          );
          $('.js-field-has-cover-attachment-on-minicard').toggleClass(
            CKCLS,
            this.currentBoard.allowsCoverAttachmentOnMinicard,
          );
        },
        'click .js-field-has-badge-attachment-on-minicard'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsBadgeAttachmentOnMinicard = !this.currentBoard
            .allowsBadgeAttachmentOnMinicard;
          this.currentBoard.setallowsBadgeAttachmentOnMinicard(
            this.currentBoard.allowsBadgeAttachmentOnMinicard,
          );
          $(`.js-field-has-badge-attachment-on-minicard ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsBadgeAttachmentOnMinicard,
          );
          $('.js-field-has-badge-attachment-on-minicard').toggleClass(
            CKCLS,
            this.currentBoard.allowsBadgeAttachmentOnMinicard,
          );
        },
        'click .js-field-has-card-sorting-by-number-on-minicard'(evt) {
          evt.preventDefault();
          this.currentBoard.allowsCardSortingByNumberOnMinicard = !this.currentBoard
            .allowsCardSortingByNumberOnMinicard;
          this.currentBoard.setallowsCardSortingByNumberOnMinicard(
            this.currentBoard.allowsCardSortingByNumberOnMinicard,
          );
          $(`.js-field-has-card-sorting-by-number-on-minicard ${MCB}`).toggleClass(
            CKCLS,
            this.currentBoard.allowsCardSortingByNumberOnMinicard,
          );
          $('.js-field-has-card-sorting-by-number-on-minicard').toggleClass(
            CKCLS,
            this.currentBoard.allowsCardSortingByNumberOnMinicard,
          );
        },
      },
    ];
  },
}).register('boardCardSettingsPopup');

BlazeComponent.extendComponent({
  onCreated() {
    this.error = new ReactiveVar('');
    this.loading = new ReactiveVar(false);
  },

  onRendered() {
    this.find('.js-search-member input').focus();
    this.setLoading(false);
  },

  isBoardMember() {
    const userId = this.currentData().__originalId;
    const user = ReactiveCache.getUser(userId);
    return user && user.isBoardMember();
  },

  isValidEmail(email) {
    return SimpleSchema.RegEx.Email.test(email);
  },

  setError(error) {
    this.error.set(error);
  },

  setLoading(w) {
    this.loading.set(w);
  },

  isLoading() {
    return this.loading.get();
  },

  inviteUser(idNameEmail) {
    const boardId = Session.get('currentBoard');
    this.setLoading(true);
    const self = this;
    Meteor.call('inviteUserToBoard', idNameEmail, boardId, (err, ret) => {
      self.setLoading(false);
      if (err) self.setError(err.error);
      else if (ret.email) self.setError('email-sent');
      else Popup.back();
    });
  },

  events() {
    return [
      {
        'keyup input'() {
          this.setError('');
        },
        'click .js-select-member'() {
          const userId = this.currentData().__originalId;
          const currentBoard = Utils.getCurrentBoard();
          if (!currentBoard.hasMember(userId)) {
            this.inviteUser(userId);
          }
        },
        'click .js-email-invite'() {
          const idNameEmail = $('.js-search-member input').val();
          if (idNameEmail.indexOf('@') < 0 || this.isValidEmail(idNameEmail)) {
            this.inviteUser(idNameEmail);
          } else this.setError('email-invalid');
        },
      },
    ];
  },
}).register('addMemberPopup');

Template.addMemberPopup.helpers({
  searchIndex: () => UserSearchIndex,
})

BlazeComponent.extendComponent({
  onCreated() {
    this.error = new ReactiveVar('');
    this.loading = new ReactiveVar(false);
    this.findOrgsOptions = new ReactiveVar({});

    this.page = new ReactiveVar(1);
    this.autorun(() => {
      const limitOrgs = this.page.get() * Number.MAX_SAFE_INTEGER;
      this.subscribe('org', this.findOrgsOptions.get(), limitOrgs, () => {});
    });
  },

  onRendered() {
    this.setLoading(false);
  },

  setError(error) {
    this.error.set(error);
  },

  setLoading(w) {
    this.loading.set(w);
  },

  isLoading() {
    return this.loading.get();
  },

  events() {
    return [
      {
        'keyup input'() {
          this.setError('');
        },
        'change #jsBoardOrgs'() {
          let currentBoard = Utils.getCurrentBoard();
          let selectElt = document.getElementById("jsBoardOrgs");
          let selectedOrgId = selectElt.options[selectElt.selectedIndex].value;
          let selectedOrgDisplayName = selectElt.options[selectElt.selectedIndex].text;
          let boardOrganizations = [];
          if(currentBoard.orgs !== undefined){
            for(let i = 0; i < currentBoard.orgs.length; i++){
              boardOrganizations.push(currentBoard.orgs[i]);
            }
          }

          if(!boardOrganizations.some((org) => org.orgDisplayName == selectedOrgDisplayName)){
            boardOrganizations.push({
              "orgId": selectedOrgId,
              "orgDisplayName": selectedOrgDisplayName,
              "isActive" : true,
            })

            if (selectedOrgId != "-1") {
              Meteor.call('setBoardOrgs', boardOrganizations, currentBoard._id);
            }
          }

          Popup.back();
        },
      },
    ];
  },
}).register('addBoardOrgPopup');

Template.addBoardOrgPopup.helpers({
  orgsDatas() {
    let ret = ReactiveCache.getOrgs({}, {sort: { orgDisplayName: 1 }});
    return ret;
  },
});

BlazeComponent.extendComponent({
  onCreated() {
    this.error = new ReactiveVar('');
    this.loading = new ReactiveVar(false);
    this.findOrgsOptions = new ReactiveVar({});

    this.page = new ReactiveVar(1);
    this.autorun(() => {
      const limitOrgs = this.page.get() * Number.MAX_SAFE_INTEGER;
      this.subscribe('org', this.findOrgsOptions.get(), limitOrgs, () => {});
    });
  },

  onRendered() {
    this.setLoading(false);
  },

  setError(error) {
    this.error.set(error);
  },

  setLoading(w) {
    this.loading.set(w);
  },

  isLoading() {
    return this.loading.get();
  },

  events() {
    return [
      {
        'keyup input'() {
          this.setError('');
        },
        'click #leaveBoardBtn'(){
          let stringOrgId = document.getElementById('hideOrgId').value;
          let currentBoard = Utils.getCurrentBoard();
          let boardOrganizations = [];
          if(currentBoard.orgs !== undefined){
            for(let i = 0; i < currentBoard.orgs.length; i++){
              if(currentBoard.orgs[i].orgId != stringOrgId){
                boardOrganizations.push(currentBoard.orgs[i]);
              }
            }
          }

          Meteor.call('setBoardOrgs', boardOrganizations, currentBoard._id);

          Popup.back();
        },
        'click #cancelLeaveBoardBtn'(){
          Popup.back();
        },
      },
    ];
  },
}).register('removeBoardOrgPopup');

Template.removeBoardOrgPopup.helpers({
  org() {
    return ReactiveCache.getOrg(this.orgId);
  },
});

BlazeComponent.extendComponent({
  onCreated() {
    this.error = new ReactiveVar('');
    this.loading = new ReactiveVar(false);
    this.findOrgsOptions = new ReactiveVar({});

    this.page = new ReactiveVar(1);
    this.autorun(() => {
      const limitTeams = this.page.get() * Number.MAX_SAFE_INTEGER;
      this.subscribe('team', this.findOrgsOptions.get(), limitTeams, () => {});
    });

    this.findUsersOptions = new ReactiveVar({});
    this.userPage = new ReactiveVar(1);
    this.autorun(() => {
      const limitUsers = this.userPage.get() * Number.MAX_SAFE_INTEGER;
      this.subscribe('people', this.findUsersOptions.get(), limitUsers, () => {});
    });
  },

  onRendered() {
    this.setLoading(false);
  },

  setError(error) {
    this.error.set(error);
  },

  setLoading(w) {
    this.loading.set(w);
  },

  isLoading() {
    return this.loading.get();
  },

  events() {
    return [
      {
        'keyup input'() {
          this.setError('');
        },
        'change #jsBoardTeams'() {
          let currentBoard = Utils.getCurrentBoard();
          let selectElt = document.getElementById("jsBoardTeams");
          let selectedTeamId = selectElt.options[selectElt.selectedIndex].value;
          let selectedTeamDisplayName = selectElt.options[selectElt.selectedIndex].text;
          let boardTeams = [];
          if(currentBoard.teams !== undefined){
            for(let i = 0; i < currentBoard.teams.length; i++){
              boardTeams.push(currentBoard.teams[i]);
            }
          }

          if(!boardTeams.some((team) => team.teamDisplayName == selectedTeamDisplayName)){
            boardTeams.push({
              "teamId": selectedTeamId,
              "teamDisplayName": selectedTeamDisplayName,
              "isActive" : true,
            })

            if (selectedTeamId != "-1") {
              let members = currentBoard.members;

              let query = {
                "teams.teamId": { $in: boardTeams.map(t => t.teamId) },
              };

              const boardTeamUsers = ReactiveCache.getUsers(query, {
                sort: { sort: 1 },
              });

              if(boardTeams !== undefined && boardTeams.length > 0){
                let index;
                if (boardTeamUsers && boardTeamUsers.length > 0) {
                  boardTeamUsers.forEach((u) => {
                    index = members.findIndex(function(m){ return m.userId == u._id});
                    if(index == -1){
                      members.push({
                        "isActive": true,
                        "isAdmin": u.isAdmin !== undefined ? u.isAdmin : false,
                        "isCommentOnly" : false,
                        "isNoComments" : false,
                        "userId": u._id,
                      });
                    }
                  });
                }
              }

              Meteor.call('setBoardTeams', boardTeams, members, currentBoard._id);
            }
          }

          Popup.back();
        },
      },
    ];
  },
}).register('addBoardTeamPopup');

Template.addBoardTeamPopup.helpers({
  teamsDatas() {
    let ret = ReactiveCache.getTeams({}, {sort: { teamDisplayName: 1 }});
    return ret;
  },
});

BlazeComponent.extendComponent({
  onCreated() {
    this.error = new ReactiveVar('');
    this.loading = new ReactiveVar(false);
    this.findOrgsOptions = new ReactiveVar({});

    this.page = new ReactiveVar(1);
    this.autorun(() => {
      const limitTeams = this.page.get() * Number.MAX_SAFE_INTEGER;
      this.subscribe('team', this.findOrgsOptions.get(), limitTeams, () => {});
    });

    this.findUsersOptions = new ReactiveVar({});
    this.userPage = new ReactiveVar(1);
    this.autorun(() => {
      const limitUsers = this.userPage.get() * Number.MAX_SAFE_INTEGER;
      this.subscribe('people', this.findUsersOptions.get(), limitUsers, () => {});
    });
  },

  onRendered() {
    this.setLoading(false);
  },

  setError(error) {
    this.error.set(error);
  },

  setLoading(w) {
    this.loading.set(w);
  },

  isLoading() {
    return this.loading.get();
  },

  events() {
    return [
      {
        'keyup input'() {
          this.setError('');
        },
        'click #leaveBoardTeamBtn'(){
          let stringTeamId = document.getElementById('hideTeamId').value;
          let currentBoard = Utils.getCurrentBoard();
          let boardTeams = [];
          if(currentBoard.teams !== undefined){
            for(let i = 0; i < currentBoard.teams.length; i++){
              if(currentBoard.teams[i].teamId != stringTeamId){
                boardTeams.push(currentBoard.teams[i]);
              }
            }
          }

          let members = currentBoard.members;
          let query = {
            "teams.teamId": stringTeamId
          };

          const boardTeamUsers = ReactiveCache.getUsers(query, {
            sort: { sort: 1 },
          });

          if(currentBoard.teams !== undefined && currentBoard.teams.length > 0){
            let index;
            if (boardTeamUsers && boardTeamUsers.length > 0) {
              boardTeamUsers.forEach((u) => {
                index = members.findIndex(function(m){ return m.userId == u._id});
                if(index !== -1 && (u.isAdmin === undefined || u.isAdmin == false)){
                  members.splice(index, 1);
                }
              });
            }
          }

          Meteor.call('setBoardTeams', boardTeams, members, currentBoard._id);

          Popup.back();
        },
        'click #cancelLeaveBoardTeamBtn'(){
          Popup.back();
        },
      },
    ];
  },
}).register('removeBoardTeamPopup');

Template.removeBoardTeamPopup.helpers({
  team() {
    return ReactiveCache.getTeam(this.teamId);
  },
});

Template.changePermissionsPopup.events({
  'click .js-set-admin, click .js-set-normal, click .js-set-no-comments, click .js-set-comment-only, click .js-set-worker'(
    event,
  ) {
    const currentBoard = Utils.getCurrentBoard();
    const memberId = this.userId;
    const isAdmin = $(event.currentTarget).hasClass('js-set-admin');
    const isCommentOnly = $(event.currentTarget).hasClass(
      'js-set-comment-only',
    );
    const isNoComments = $(event.currentTarget).hasClass('js-set-no-comments');
    const isWorker = $(event.currentTarget).hasClass('js-set-worker');
    currentBoard.setMemberPermission(
      memberId,
      isAdmin,
      isNoComments,
      isCommentOnly,
      isWorker,
    );
    Popup.back(1);
  },
});

Template.changePermissionsPopup.helpers({
  isAdmin() {
    const currentBoard = Utils.getCurrentBoard();
    return currentBoard.hasAdmin(this.userId);
  },

  isNormal() {
    const currentBoard = Utils.getCurrentBoard();
    return (
      !currentBoard.hasAdmin(this.userId) &&
      !currentBoard.hasNoComments(this.userId) &&
      !currentBoard.hasCommentOnly(this.userId) &&
      !currentBoard.hasWorker(this.userId)
    );
  },

  isNoComments() {
    const currentBoard = Utils.getCurrentBoard();
    return (
      !currentBoard.hasAdmin(this.userId) &&
      currentBoard.hasNoComments(this.userId)
    );
  },

  isCommentOnly() {
    const currentBoard = Utils.getCurrentBoard();
    return (
      !currentBoard.hasAdmin(this.userId) &&
      currentBoard.hasCommentOnly(this.userId)
    );
  },

  isWorker() {
    const currentBoard = Utils.getCurrentBoard();
    return (
      !currentBoard.hasAdmin(this.userId) && currentBoard.hasWorker(this.userId)
    );
  },

  isLastAdmin() {
    const currentBoard = Utils.getCurrentBoard();
    return (
      currentBoard.hasAdmin(this.userId) && currentBoard.activeAdmins() === 1
    );
  },
});
