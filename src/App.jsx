import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Users, Calendar, AlertTriangle, CheckCircle,
  Settings, ChevronRight, ChevronLeft,
  Coffee, ChefHat, Edit, BarChart2,
  ArrowUp, ArrowDown, Trash2, UserPlus, GripVertical
} from 'lucide-react';
import JapaneseHolidays from 'japanese-holidays';

// カフェ・ド・クリエ渋谷3丁目店のシフト時間帯 (準備・片付けを含め 06:30 - 21:30) 30分刻み
// 平日はこの全時間帯、日曜・祝日は最後の1時間 (20:30-21:30) を除いた 06:30 - 20:30 になる
const TIME_SLOTS = [
  '06:30 - 07:00', '07:00 - 07:30', '07:30 - 08:00', '08:00 - 08:30', '08:30 - 09:00',
  '09:00 - 09:30', '09:30 - 10:00', '10:00 - 10:30', '10:30 - 11:00',
  '11:00 - 11:30', '11:30 - 12:00', '12:00 - 12:30', '12:30 - 13:00',
  '13:00 - 13:30', '13:30 - 14:00', '14:00 - 14:30', '14:30 - 15:00',
  '15:00 - 15:30', '15:30 - 16:00', '16:00 - 16:30', '16:30 - 17:00',
  '17:00 - 17:30', '17:30 - 18:00', '18:00 - 18:30', '18:30 - 19:00',
  '19:00 - 19:30', '19:30 - 20:00', '20:00 - 20:30', '20:30 - 21:00',
  '21:00 - 21:30'
];

// 日曜・祝日用の短縮営業時間帯 (06:30 - 20:30)
const REDUCED_HOURS_TIME_SLOTS = TIME_SLOTS.slice(0, -2);

// 指定日が日曜日または日本の祝日 (短縮営業日) かどうか
const isReducedHoursDate = (year, month, day) => {
  const date = new Date(year, month - 1, day);
  if (date.getDay() === 0) return true; // 日曜日
  return !!JapaneseHolidays.isHoliday(date); // 祝日 (振替休日を含む)
};

// 指定日に実際に使うべき時間帯配列を返す (平日: 06:30-21:30 / 日祝: 06:30-20:30)
const getTimeSlotsForDate = (year, month, day) => (
  isReducedHoursDate(year, month, day) ? REDUCED_HOURS_TIME_SLOTS : TIME_SLOTS
);

// 時間帯別の必要人数 (渋谷3丁目店の混雑傾向を反映)
const getRequiredStaffCount = (slot) => {
  const startHour = parseFloat(slot.substring(0, 5).replace(':', '.'));
  
  if (startHour >= 12.0 && startHour < 14.0) return 5; // ランチピーク (12:00-14:00)
  if (startHour >= 17.0 && startHour < 19.0) return 4; // 夕方ピーク (17:00-19:00)
  if (startHour >= 8.5 && startHour < 9.5) return 4;   // 朝のラッシュ (8:30-9:30)
  return 3; // その他の時間は基本3名
};

const BREAK_ELIGIBLE_SLOTS = 12; // 6時間 = 30分コマ12個以上で休憩対象
const BREAK_LENGTH_SLOTS = 2;    // 休憩1時間 = 30分コマ2個
const EDGE_GUARD_SLOTS = 2;      // 勤務の最初と最後の1時間は休憩を避ける

// 勤務ブロック(連続した TIME_SLOTS の配列)から、休憩として除外する時間帯を返す。
// daySchedule はその日の「休憩を差し引く前」の仮配置状態 ({slot: [従業員, ...]})。
// 他の全スタッフの配置(＝他の人の休憩も反映済みなら尚良い)を踏まえて、
// 1. 自分が抜けることでフード担当0人になる時間帯を避け、
// 2. 自分が抜けることで人数不足(必要人数割れ)になる/悪化する時間帯を避け、
// 3. それでも同点なら混雑ピークでない時間帯を優先、
// 4. 最後は中央付近を優先する、という優先順位で1時間の休憩位置を選ぶ。
// 6時間未満の勤務は休憩なし。最初と最後の1時間は対象から除外する。
const chooseBreakSlots = (block, daySchedule, emp) => {
  if (block.length < BREAK_ELIGIBLE_SLOTS) return [];
  const earliestStart = EDGE_GUARD_SLOTS;
  const latestStart = block.length - EDGE_GUARD_SLOTS - BREAK_LENGTH_SLOTS;
  if (latestStart < earliestStart) return [];

  const midpoint = earliestStart + (latestStart - earliestStart) / 2;
  let bestStartIdx = earliestStart;
  let bestScore = Infinity;

  for (let startIdx = earliestStart; startIdx <= latestStart; startIdx++) {
    const candidate = block.slice(startIdx, startIdx + BREAK_LENGTH_SLOTS);
    let cookGapScore = 0;
    let deficitScore = 0;
    let demandScore = 0;

    candidate.forEach(s => {
      const assignedAtSlot = daySchedule[s] || [];
      const countAfterBreak = assignedAtSlot.length - 1; // 自分が抜けた後の人数
      const cookCountAfterBreak = assignedAtSlot.filter(e => e.canCook).length - (emp.canCook ? 1 : 0);

      if (emp.canCook && cookCountAfterBreak < 1) cookGapScore += 1;
      deficitScore += Math.max(0, getRequiredStaffCount(s) - countAfterBreak);
      demandScore += getRequiredStaffCount(s);
    });

    const distanceFromMiddle = Math.abs(startIdx - midpoint);
    // フード担当0人化を最優先で回避 > 人数不足の悪化を回避 > 混雑ピーク回避 > 中央寄り
    const score = cookGapScore * 100000 + deficitScore * 1000 + demandScore * 10 + distanceFromMiddle;
    if (score < bestScore) {
      bestScore = score;
      bestStartIdx = startIdx;
    }
  }
  return block.slice(bestStartIdx, bestStartIdx + BREAK_LENGTH_SLOTS);
};

// 曜日配列
const DAYS_OF_WEEK = ['日', '月', '火', '水', '木', '金', '土'];

// 初期従業員名リスト (32名)
const STAFF_NAMES = [
  '長井咲由莉', '中田裕子', '江連涼羽', '西口海斗', '鷹取りょう', '所谷陽', '久保颯一朗', '水落成海',
  '武藤聖亜', '新井琴羽', '畑中瑞希', '田中優月', '佐橋樹哉', '萱野夕歌', '天野龍哉', '荒木美音',
  '吉田彩子', '山口蓮奈', '萩原碧泉', '嘉本祥大', 'ロイプジャ', '豊泉玲奈', '渡辺桐子', '清水麻衣',
  '山岸優澄', '保科美琴', '熊崎卓', '服部果歩', '渡瀬愛子', '正木乃彩', '谷野愛莉', '岩佐珠希'
];

// 希望シフトを提出する20名 (フード担当[0-16]・非対応[17-31]の実際の比率に近い形で抽出し、
// 提出者がフード担当に偏らないようにする)
const PREFERENCE_SUBMITTER_INDICES = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, // フード担当から11名
  17, 18, 19, 20, 21, 22, 23, 24, 25 // 非対応から9名
]);

// ダミーデータ生成時に基準とする年月 (アプリの対象月の初期値と揃える)
const DEFAULT_TARGET_YEAR = new Date().getFullYear();
const DEFAULT_TARGET_MONTH = new Date().getMonth() + 1;

// 31日分のダミー希望シフトを生成する関数 (よくばらけた状態を作る)
const generateDummyPreferences = (empIndex) => {
  const prefs = {};
  // 32人のうち、上記の20人だけが希望シフトを提出している状態にする
  if (!PREFERENCE_SUBMITTER_INDICES.has(empIndex)) return prefs;

  // 1日〜31日までダミーデータを生成
  for (let day = 1; day <= 31; day++) {
    // 人と日付の組み合わせで、週休2〜3日程度の休みをランダム風に設定
    if ((empIndex * 2 + day) % 7 < 2) continue;

    // その日の実際の営業時間帯 (日曜・祝日は 06:30-20:30 に短縮)
    const daySlots = getTimeSlotsForDate(DEFAULT_TARGET_YEAR, DEFAULT_TARGET_MONTH, day);

    // 出勤時間帯のパターンをばらけさせる (0: 朝, 1: 昼, 2: 夜, 3: フルタイム)
    const pattern = (empIndex + day) % 4;
    let selectedSlots = [];

    if (pattern === 0) {
      // 朝メイン (06:30 - 13:00)
      selectedSlots = daySlots.slice(0, 13);
    } else if (pattern === 1) {
      // 昼メイン (11:00 - 17:00)
      selectedSlots = daySlots.slice(9, 21);
    } else if (pattern === 2) {
      // 夜メイン (17:00 - 閉店まで)
      selectedSlots = daySlots.slice(21);
    } else {
      // 日中通し (09:00 - 18:00)
      selectedSlots = daySlots.slice(5, 23);
    }
    prefs[day] = selectedSlots;
  }
  return prefs;
};

// 初期データ生成: 従業員32名 (うちフード担当17名)
const INITIAL_STAFF = STAFF_NAMES.map((name, i) => ({
  id: `EMP${String(i + 1).padStart(3, '0')}`,
  name: name,
  canCook: i < 17, // 最初の17人がフード担当可能
  preferences: generateDummyPreferences(i)
}));


export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [staff, setStaff] = useState(INITIAL_STAFF);
  const [schedule, setSchedule] = useState({});
  const [shortages, setShortages] = useState({});
  // 現在の schedule/shortages がどの年月分として生成されたか (対象月の切替時に古いデータと区別するため)
  const [scheduledMonth, setScheduledMonth] = useState(null);
  const [targetYear, setTargetYear] = useState(new Date().getFullYear());
  const [targetMonth, setTargetMonth] = useState(new Date().getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState(1);
  // シフト表ページの日付ピッカー（カレンダー）の開閉状態
  const [showDayPicker, setShowDayPicker] = useState(false);

  // シフト入力フォーム用のステート
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  // 希望シフトの範囲選択 (開始タップ→終了タップで連続した1ブロックのみを設定)
  const [rangeStart, setRangeStart] = useState(null);
  // 新規従業員追加用のステート
  const [newStaffName, setNewStaffName] = useState('');
  // 削除確認モーダルの対象 (削除ボタンを押した従業員。null なら非表示)
  const [staffPendingDeletion, setStaffPendingDeletion] = useState(null);

  // ドラッグ＆ドロップ（長押し・iOSライク）関連のStateとRef
  const [draggedIndex, setDraggedIndex] = useState(null);
  const dragTimeoutRef = useRef(null);
  const isDraggingRef = useRef(false);

  // 「日付が変わった時だけ」自動選択の再計算に使う最新の staff を保持する Ref
  // (依存配列を selectedDay のみにするため、staff の変化そのものでは再実行させない)
  const staffRef = useRef(staff);
  useEffect(() => {
    staffRef.current = staff;
  });

  // コンポーネント破棄時にタイマーをクリーンアップ
  useEffect(() => {
    return () => {
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    };
  }, []);

  // 従業員や日付の選択が変わったら、範囲選択の開始待ち状態をリセット
  useEffect(() => {
    setRangeStart(null);
  }, [selectedEmployeeId, selectedDay]);

  // 日付が変わったら、その日にシフト希望を出している人のうち一覧の一番上に来る人を自動選択する。
  // staff の更新（希望シフトの編集など）では再実行したくないため、依存配列は selectedDay のみにする。
  useEffect(() => {
    const currentStaff = staffRef.current;
    const topStaffForDay = currentStaff.find(emp => (emp.preferences[selectedDay]?.length || 0) > 0) || currentStaff[0];
    setSelectedEmployeeId(topStaffForDay?.id ?? null);
  }, [selectedDay]);

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();

  const getDayOfWeek = (day) => {
    const date = new Date(targetYear, targetMonth - 1, day);
    return DAYS_OF_WEEK[date.getDay()];
  };

  const generateSchedule = () => {
    const newSchedule = {};
    const newShortages = {};

    // 月を通じた労働コマ数のトラッキング (労働時間平準化用: 月内で少ない人を優先的に採用)
    const slotsWorkedMonth = {};
    staff.forEach(emp => slotsWorkedMonth[emp.id] = 0);

    // 1日から月末日までループ
    for (let day = 1; day <= daysInMonth; day++) {
      // その日の実際の営業時間帯 (日曜・祝日は 06:30-20:30 に短縮)
      const daySlots = getTimeSlotsForDate(targetYear, targetMonth, day);

      newSchedule[day] = {};
      daySlots.forEach(slot => { newSchedule[day][slot] = []; });
      newShortages[day] = [];

      // その日に希望シフト(連続した1ブロック)を出している従業員
      const candidates = staff.filter(emp => (emp.preferences[day]?.length || 0) > 0);
      // 1人1日1ブロックのみ: 一度採用した人はその日はもう選ばない
      const assignedIds = new Set();
      // この日に採用した人と、その希望ブロック (休憩を差し引く前)
      const recruitedThisDay = [];

      // フェーズ1: まず休憩を考慮せず (全員フル出勤している前提で) 必要人数を満たすように採用する。
      // こうすることで、後から差し引く休憩の影響を過不足なく把握できる。
      daySlots.forEach(slot => {
        const REQUIRED_STAFF = getRequiredStaffCount(slot);

        // 既にこのコマをカバーしている人数・フード担当数が満たされるまで、
        // 「その日まだ未採用」かつ「連続希望ブロックがこのコマを含む」従業員を1ブロックまるごと追加していく
        let needCook = newSchedule[day][slot].filter(s => s.canCook).length < 1;
        let needMore = newSchedule[day][slot].length < REQUIRED_STAFF;

        while (needCook || needMore) {
          const eligible = candidates.filter(emp =>
            !assignedIds.has(emp.id) && emp.preferences[day].includes(slot)
          );
          if (eligible.length === 0) break; // これ以上補充できる人がいない

          // フード担当が必要ならフード担当者を優先。頭数を埋めるだけの場合は、
          // 生成されるシフト表がフード担当に偏らないよう非対応者を優先する
          let pool = needCook
            ? eligible.filter(emp => emp.canCook)
            : eligible.filter(emp => !emp.canCook);
          if (pool.length === 0) pool = eligible;

          // 月内の労働コマ数が少ない人を優先 (労働時間の平準化)
          pool.sort((a, b) => slotsWorkedMonth[a.id] - slotsWorkedMonth[b.id]);
          const chosen = pool[0];

          // 採用した人の希望ブロック全体をその日のシフトとして一括登録 (連続勤務を保証)。
          // その日が短縮営業などで希望ブロックが実際の営業時間帯を超えている場合に備え、
          // daySlots に存在するコマだけに絞り込む。
          const block = chosen.preferences[day].filter(s => daySlots.includes(s));
          block.forEach(s => newSchedule[day][s].push(chosen));
          assignedIds.add(chosen.id);
          recruitedThisDay.push({ emp: chosen, block });

          needCook = newSchedule[day][slot].filter(s => s.canCook).length < 1;
          needMore = newSchedule[day][slot].length < REQUIRED_STAFF;
        }
      });

      // フェーズ2: 採用が確定した全員のフル配置状態を踏まえて、休憩(6時間以上勤務の人のみ)を割り当てる。
      // 1人ずつ休憩を引くたびに残り人数が更新されるため、後の人ほど「他の人の休憩」も考慮した上で
      // できるだけ人員不足を生まない時間帯が選ばれる。
      recruitedThisDay.forEach(({ emp, block }) => {
        const breakSlots = chooseBreakSlots(block, newSchedule[day], emp);
        if (breakSlots.length === 0) {
          slotsWorkedMonth[emp.id] += block.length;
          return;
        }
        breakSlots.forEach(s => {
          newSchedule[day][s] = newSchedule[day][s].filter(e => e.id !== emp.id);
        });
        slotsWorkedMonth[emp.id] += block.length - breakSlots.length;
      });

      // 人数・スキル不足チェックと記録 (休憩を反映した最終状態で判定)
      daySlots.forEach(slot => {
        const assignedStaff = newSchedule[day][slot];
        const REQUIRED_STAFF = getRequiredStaffCount(slot);
        const cookCount = assignedStaff.filter(s => s.canCook).length;
        if (cookCount < 1) {
          newShortages[day].push({
            slot,
            reason: 'フード担当者が必要 (現状0人)'
          });
        }
        if (assignedStaff.length < REQUIRED_STAFF) {
          newShortages[day].push({
            slot,
            reason: `人数不足 (現在${assignedStaff.length}人 / 最低${REQUIRED_STAFF}人必要)`
          });
        }
      });
    }

    setSchedule(newSchedule);
    setShortages(newShortages);
    setScheduledMonth({ year: targetYear, month: targetMonth });
    // シフト生成後は自動的にシフト表タブへ遷移
    setActiveTab('schedule');
  };

  const handlePreferenceSlotClick = (empId, day, slotIndex) => {
    if (rangeStart === null) {
      setRangeStart(slotIndex);
      return;
    }
    const daySlots = getTimeSlotsForDate(targetYear, targetMonth, day);
    const startIdx = Math.min(rangeStart, slotIndex);
    const endIdx = Math.max(rangeStart, slotIndex);
    const block = daySlots.slice(startIdx, endIdx + 1);
    setStaff(prev => prev.map(emp =>
      emp.id !== empId ? emp : {
        ...emp,
        preferences: { ...emp.preferences, [day]: block }
      }
    ));
    setRangeStart(null);
  };

  const clearPreferenceDay = (empId, day) => {
    setStaff(prev => prev.map(emp =>
      emp.id !== empId ? emp : {
        ...emp,
        preferences: { ...emp.preferences, [day]: [] }
      }
    ));
    setRangeStart(null);
  };

  const toggleCookStatus = (empId) => {
    setStaff(prev => prev.map(emp => 
      emp.id === empId ? { ...emp, canCook: !emp.canCook } : emp
    ));
  };

  const changeMonth = (offset) => {
    let newMonth = targetMonth + offset;
    let newYear = targetYear;
    if (newMonth > 12) {
      newMonth = 1;
      newYear++;
    } else if (newMonth < 1) {
      newMonth = 12;
      newYear--;
    }
    setTargetMonth(newMonth);
    setTargetYear(newYear);
    setSelectedDay(1); // Reset day when month changes
  };

  const handleAddStaff = () => {
    if (!newStaffName.trim()) return;
    
    // 新しいIDの生成（既存の最大ID+1）
    let maxId = 0;
    staff.forEach(emp => {
      if (emp.id.startsWith('EMP')) {
        const num = parseInt(emp.id.replace('EMP', ''), 10);
        if (!isNaN(num) && num > maxId) maxId = num;
      }
    });
    const newId = `EMP${String(maxId + 1).padStart(3, '0')}`;

    const newEmp = {
      id: newId,
      name: newStaffName.trim(),
      canCook: false,
      preferences: {}
    };
    
    const updatedStaff = [...staff, newEmp];
    setStaff(updatedStaff);
    setNewStaffName('');
    if (!selectedEmployeeId) {
      setSelectedEmployeeId(newId);
    }
  };

  const handleDeleteStaff = (id) => {
    const updatedStaff = staff.filter(emp => emp.id !== id);
    setStaff(updatedStaff);

    // 削除された従業員が選択中だった場合、別の従業員を選択状態にする
    if (selectedEmployeeId === id) {
      setSelectedEmployeeId(updatedStaff.length > 0 ? updatedStaff[0].id : null);
    }
  };

  const confirmDeleteStaff = () => {
    if (!staffPendingDeletion) return;
    handleDeleteStaff(staffPendingDeletion.id);
    setStaffPendingDeletion(null);
  };

  const moveStaffUp = (index) => {
    if (index === 0) return;
    const newStaff = [...staff];
    [newStaff[index - 1], newStaff[index]] = [newStaff[index], newStaff[index - 1]];
    setStaff(newStaff);
  };

  const moveStaffDown = (index) => {
    if (index === staff.length - 1) return;
    const newStaff = [...staff];
    [newStaff[index + 1], newStaff[index]] = [newStaff[index], newStaff[index + 1]];
    setStaff(newStaff);
  };

  // --- 長押しドラッグ＆ドロップ (iOSライク) の処理 ---
  const handlePointerDown = (e, index) => {
    // PCの場合は左クリックのみ許可
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    
    // 削除ボタンや切替ボタンを押した時はドラッグを発火させない
    if (e.target.closest('button')) return;

    // 長押しの判定 (300ms)
    dragTimeoutRef.current = setTimeout(() => {
      setDraggedIndex(index);
      isDraggingRef.current = true;
      // 対応端末で軽いバイブレーション
      if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(40);
      }
      // ドラッグ中のスクロールや余計なアクションを防ぐ
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
      document.body.style.userSelect = 'none';
    }, 300);
  };

  const handlePointerMove = (e) => {
    // 長押し成立前に指が動いたらキャンセル（通常のスクロールと判別）
    if (!isDraggingRef.current && dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = null;
      return;
    }

    if (isDraggingRef.current && draggedIndex !== null) {
      // スクロール等のデフォルト動作を防ぐ
      if (e.cancelable) e.preventDefault(); 
      
      // 指やカーソルの下にある要素を特定
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (target) {
        const row = target.closest('[data-row-index]');
        if (row) {
          const hoverIndex = parseInt(row.getAttribute('data-row-index'), 10);
          // 別の行の上に乗った場合、即座に配列を入れ替える（動的な入れ替わり）
          if (hoverIndex !== draggedIndex && !isNaN(hoverIndex)) {
             setStaff(prev => {
                const newStaff = [...prev];
                const item = newStaff.splice(draggedIndex, 1)[0];
                newStaff.splice(hoverIndex, 0, item);
                return newStaff;
             });
             // 追いかけるように現在のインデックスを更新
             setDraggedIndex(hoverIndex);
          }
        }
      }
    }
  };

  const handlePointerUp = () => {
    // タイマーのリセット
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = null;
    }
    // ドラッグ状態の解除とスクロール制限の復元
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setDraggedIndex(null);
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
      document.body.style.userSelect = '';
    }
  };
  // ------------------------------------------------

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
           <h2 className="text-xl font-bold text-gray-800 mb-1">シフト対象月設定</h2>
           <p className="text-sm text-gray-500">シフトを作成する年月を選択してください。</p>
        </div>
        <div className="flex items-center space-x-2 md:space-x-4 w-full md:w-auto justify-center bg-gray-50 md:bg-transparent p-2 md:p-0 rounded-lg">
          <button onClick={() => changeMonth(-1)} className="p-2 bg-white md:bg-gray-100 rounded-full hover:bg-gray-200 shadow-sm md:shadow-none"><ChevronLeft size={20} /></button>
          <span className="text-xl md:text-2xl font-bold w-32 md:w-40 text-center">{targetYear}年 {targetMonth}月</span>
          <button onClick={() => changeMonth(1)} className="p-2 bg-white md:bg-gray-100 rounded-full hover:bg-gray-200 shadow-sm md:shadow-none"><ChevronRight size={20} /></button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
            <Users className="mr-2 text-blue-500" />
            現在のスタッフ状況
          </h2>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="bg-blue-50 p-4 rounded-lg flex-1">
              <div className="text-sm text-blue-600 font-medium">総従業員数</div>
              <div className="text-2xl md:text-3xl font-bold text-blue-800">{staff.length}名</div>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg flex-1">
              <div className="text-sm text-orange-600 font-medium">フード対応可能</div>
              <div className="text-2xl md:text-3xl font-bold text-orange-800">
                {staff.filter(s => s.canCook).length}名
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-800 mb-2 flex items-center">
              <Settings className="mr-2 text-gray-500" />
              シフト生成アクション
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              スタッフの希望シフトと最適化条件に基づき、1ヶ月分のシフトを自動生成します。
            </p>
          </div>
          <button
            onClick={generateSchedule}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center shadow-md mt-auto"
          >
            <Calendar className="mr-2" />
            最適化してシフトを自動生成
          </button>
        </div>
      </div>
    </div>
  );

  const renderTrends = () => (
    <div className="space-y-6">
      <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-xl font-bold text-gray-800 mb-2">混雑傾向と必要人員</h2>
        <p className="text-sm md:text-base text-gray-600 mb-6">
          渋谷3丁目店の一般的な混雑傾向データに基づき、時間帯ごとに必要なスタッフ数を自動設定しています。
          この設定はシフト自動生成時の「必要人数制約」として機能します。
        </p>
        
        <div className="overflow-x-auto -mx-4 md:mx-0">
          <div className="min-w-[600px] px-4 md:px-0">
            <table className="w-full text-left border-collapse">
               <thead>
                  <tr className="bg-gray-50 text-gray-600 text-sm border-b border-gray-200">
                    <th className="p-3 font-medium border-r border-gray-100 w-32 whitespace-nowrap">時間帯</th>
                    <th className="p-3 font-medium">混雑傾向メモ</th>
                    <th className="p-3 font-medium text-center w-24 whitespace-nowrap">必要人数</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                   <tr className="hover:bg-gray-50">
                      <td className="p-3 text-sm font-medium border-r border-gray-100 whitespace-nowrap">06:30 - 08:30</td>
                      <td className="p-3 text-sm text-gray-600">開店準備および朝の出勤前。比較的穏やか。（最低3名は確保）</td>
                      <td className="p-3 text-center"><span className="font-bold text-gray-800">3名</span></td>
                   </tr>
                   <tr className="hover:bg-gray-50 bg-orange-50/30">
                      <td className="p-3 text-sm font-medium border-r border-gray-100 whitespace-nowrap">08:30 - 09:30</td>
                      <td className="p-3 text-sm text-gray-600">出社直前のピークラッシュ。テイクアウト需要等で混雑しやすい。</td>
                      <td className="p-3 text-center"><span className="font-bold text-orange-600">4名</span></td>
                   </tr>
                   <tr className="hover:bg-gray-50">
                      <td className="p-3 text-sm font-medium border-r border-gray-100 whitespace-nowrap">09:30 - 12:00</td>
                      <td className="p-3 text-sm text-gray-600">朝のラッシュが落ち着き、ランチピーク前の比較的穏やかな時間帯。（最低3名は確保）</td>
                      <td className="p-3 text-center"><span className="font-bold text-gray-800">3名</span></td>
                   </tr>
                   <tr className="hover:bg-gray-50 bg-red-50/30">
                      <td className="p-3 text-sm font-medium border-r border-gray-100 whitespace-nowrap">12:00 - 14:00</td>
                      <td className="p-3 text-sm text-gray-600">ランチタイムピーク。店内飲食・フード注文が集中するため最大人数配置。</td>
                      <td className="p-3 text-center"><span className="font-bold text-red-600">5名</span></td>
                   </tr>
                   <tr className="hover:bg-gray-50 bg-yellow-50/30">
                      <td className="p-3 text-sm font-medium border-r border-gray-100 whitespace-nowrap">14:00 - 17:00</td>
                      <td className="p-3 text-sm text-gray-600">ティータイム。一定の客数はあるがピークほどではない。</td>
                      <td className="p-3 text-center"><span className="font-bold text-yellow-600">3名</span></td>
                   </tr>
                   <tr className="hover:bg-gray-50 bg-orange-50/30">
                      <td className="p-3 text-sm font-medium border-r border-gray-100 whitespace-nowrap">17:00 - 19:00</td>
                      <td className="p-3 text-sm text-gray-600">夕方ピーク。仕事終わりの待ち合わせや軽食利用で再度混雑。</td>
                      <td className="p-3 text-center"><span className="font-bold text-orange-600">4名</span></td>
                   </tr>
                   <tr className="hover:bg-gray-50">
                      <td className="p-3 text-sm font-medium border-r border-gray-100 whitespace-nowrap">19:00 - 21:30</td>
                      <td className="p-3 text-sm text-gray-600">夜間帯および閉店作業。比較的落ち着いてくる。</td>
                      <td className="p-3 text-center"><span className="font-bold text-gray-800">3名</span></td>
                   </tr>
                </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs md:text-sm text-orange-600 bg-orange-50 border border-orange-100 rounded-lg p-3 mt-4">
          <span className="font-semibold">短縮営業について:</span> 日曜日・祝日は最後の1時間 (20:30 - 21:30) を営業しないため、
          06:30 - 20:30 の時間帯のみでシフトが組まれます。
        </p>
      </div>
    </div>
  );

  const renderPreferenceForm = () => {
    const selectedEmp = staff.find(s => s.id === selectedEmployeeId);
    // 選択中の日の実際の営業時間帯 (日曜・祝日は 06:30-20:30 に短縮)
    const daySlots = getTimeSlotsForDate(targetYear, targetMonth, selectedDay);
    const isReducedDay = daySlots.length < TIME_SLOTS.length;

    // 選択された日（selectedDay）に出勤予定（希望）がある人を上に並べ替えたリストを生成
    const sortedStaffForInput = [...staff].sort((a, b) => {
      const aHasShift = (a.preferences[selectedDay] && a.preferences[selectedDay].length > 0) ? 1 : 0;
      const bHasShift = (b.preferences[selectedDay] && b.preferences[selectedDay].length > 0) ? 1 : 0;
      
      // 出勤予定がある人を上にする (降順)
      if (aHasShift !== bHasShift) {
        return bHasShift - aHasShift;
      }
      
      // 出勤予定の有無が同じ場合は、従業員管理画面での元の並び順（インデックス）を保持する
      const aIndex = staff.findIndex(s => s.id === a.id);
      const bIndex = staff.findIndex(s => s.id === b.id);
      return aIndex - bIndex;
    });
    
    return (
      <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-6">
        <div className="w-full md:w-1/3 border-b md:border-b-0 md:border-r border-gray-100 pb-4 md:pb-0 md:pr-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">従業員選択</h2>
          <div className="h-48 md:h-[500px] overflow-y-auto space-y-2 pr-2 scrollbar-thin scrollbar-thumb-gray-300">
            {sortedStaffForInput.map(emp => {
              const hasShift = emp.preferences[selectedDay] && emp.preferences[selectedDay].length > 0;
              return (
                <button
                  key={emp.id}
                  onClick={() => setSelectedEmployeeId(selectedEmployeeId === emp.id ? null : emp.id)}
                  className={`w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg transition-colors flex justify-between items-center ${
                    selectedEmployeeId === emp.id 
                      ? 'bg-blue-600 text-white shadow-md' 
                      : hasShift 
                        ? 'bg-blue-50/60 hover:bg-blue-100 text-blue-800 border border-blue-100' // 出勤予定者のスタイル
                        : 'bg-gray-50 hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-sm md:text-base">{emp.name}</span>
                    <span className={`text-xs ${selectedEmployeeId === emp.id ? 'text-blue-200' : 'text-gray-500'}`}>
                      {emp.id} {hasShift && '• 出勤予定'}
                    </span>
                  </div>
                  {emp.canCook && <ChefHat size={16} className={selectedEmployeeId === emp.id ? 'text-orange-200 flex-shrink-0' : 'text-orange-500 flex-shrink-0'} />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="w-full md:w-2/3">
          {!selectedEmp ? (
            <div className="h-48 md:h-[500px] flex flex-col items-center justify-center text-center text-gray-400">
              <Users size={40} className="mb-3 text-gray-300" />
              <p className="text-sm md:text-base">左の一覧から従業員を選択してください。</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4">
                <h2 className="text-lg font-bold text-gray-800 truncate">
                  {selectedEmp.name} さんの希望シフト
                </h2>
                <div className="flex items-center justify-between sm:justify-center space-x-2 bg-gray-100 rounded-lg p-1 w-full sm:w-auto">
                   <button
                      onClick={() => setSelectedDay(Math.max(1, selectedDay - 1))}
                      className="p-2 md:p-1 hover:bg-white rounded shadow-sm md:shadow-none bg-white md:bg-transparent"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span className="font-medium w-32 md:w-28 text-center text-sm md:text-base">
                      {targetMonth}/{selectedDay} ({getDayOfWeek(selectedDay)})
                      {isReducedDay && <span className="block text-[10px] font-normal text-orange-500">短縮営業(〜20:30)</span>}
                    </span>
                    <button
                      onClick={() => setSelectedDay(Math.min(daysInMonth, selectedDay + 1))}
                      className="p-2 md:p-1 hover:bg-white rounded shadow-sm md:shadow-none bg-white md:bg-transparent"
                    >
                      <ChevronRight size={18} />
                    </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 mb-4 bg-blue-50 p-3 rounded-lg">
                <p className="text-xs md:text-sm text-blue-700">
                  {rangeStart === null
                    ? '出勤する開始の時間帯をタップしてください。（連続した1ブロックのみ選択可）'
                    : `開始: ${daySlots[rangeStart]} ／ 終了の時間帯をタップしてください。`}
                </p>
                <div className="flex-shrink-0 flex items-center gap-2">
                  {rangeStart !== null && (
                    <button
                      onClick={() => setRangeStart(null)}
                      className="text-xs font-medium text-gray-500 hover:text-gray-700 whitespace-nowrap"
                    >
                      キャンセル
                    </button>
                  )}
                  <button
                    onClick={() => clearPreferenceDay(selectedEmp.id, selectedDay)}
                    className="text-xs font-medium text-red-500 hover:text-red-700 whitespace-nowrap"
                  >
                    この日をクリア
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3 h-[400px] md:h-[450px] overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-gray-300">
                {daySlots.map((slot, slotIndex) => {
                  const isSelected = selectedEmp.preferences[selectedDay]?.includes(slot);
                  const isPendingStart = rangeStart === slotIndex;
                  return (
                    <button
                      key={slot}
                      onClick={() => handlePreferenceSlotClick(selectedEmp.id, selectedDay, slotIndex)}
                      className={`py-2 md:py-3 px-1 md:px-2 text-xs md:text-sm rounded-lg border-2 transition-all font-medium ${
                        isPendingStart
                          ? 'border-blue-600 bg-blue-600 text-white shadow-sm ring-2 ring-blue-300'
                          : isSelected
                            ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
                      }`}
                    >
                      {slot}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderStaff = () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full md:block">
      <div className="p-4 md:p-6 border-b border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center bg-gray-50 gap-4">
        <div>
           <h2 className="text-lg font-bold text-gray-800 flex items-center">
             <Users className="mr-2 text-blue-500" size={20} />
             従業員マスタ管理
           </h2>
           <p className="text-xs md:text-sm text-gray-500 mt-1 leading-relaxed">
             フード担当スキルの切替や従業員の管理ができます。<br className="hidden md:block" />
             <span className="font-semibold text-blue-600">Tip:</span> 各行を長押しすると浮き上がり、そのままスライドして直感的に並べ替えが可能です。
           </p>
        </div>
        
        {/* 新規追加フォーム */}
        <div className="flex items-center w-full md:w-auto bg-white p-1 rounded-lg border border-gray-200 shadow-sm flex-shrink-0">
          <input
            type="text"
            value={newStaffName}
            onChange={(e) => setNewStaffName(e.target.value)}
            placeholder="新しい従業員名..."
            className="px-3 py-1.5 md:py-2 text-sm md:text-base outline-none w-full md:w-48 bg-transparent"
            onKeyDown={(e) => e.key === 'Enter' && handleAddStaff()}
          />
          <button
            onClick={handleAddStaff}
            disabled={!newStaffName.trim()}
            className="flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium px-3 py-1.5 md:py-2 rounded-md transition-colors text-sm whitespace-nowrap"
          >
            <UserPlus size={16} className="mr-1" />
            追加
          </button>
        </div>
      </div>

      {/* ドラッグ＆ドロップ対応のリスト表示 (Divベース構造) */}
      <div 
        className="flex-1 md:max-h-[600px] overflow-y-auto relative bg-gray-50/30 scrollbar-thin scrollbar-thumb-gray-300"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ touchAction: isDraggingRef.current ? 'none' : 'auto' }} 
      >
        <div className="md:min-w-[500px]">
          {/* ヘッダー行 */}
          <div className="sticky top-0 bg-white z-10 border-b border-gray-200 shadow-sm flex items-center px-2 md:px-4 py-3 text-[10px] md:text-sm font-bold text-gray-600">
             <div className="w-6 md:w-12 text-center flex-shrink-0">順番</div>
             <div className="w-11 md:w-24 pl-1 md:pl-2 flex-shrink-0">ID</div>
             <div className="flex-1 min-w-0 pl-1">名前</div>
             <div className="w-9 md:w-28 flex items-center justify-center flex-shrink-0">
               <ChefHat size={14} className="md:hidden" />
               <span className="hidden md:inline">フード対応</span>
             </div>
             <div className="w-9 md:w-16 flex items-center justify-center flex-shrink-0">
               <Trash2 size={14} className="md:hidden" />
               <span className="hidden md:inline">削除</span>
             </div>
          </div>

          {/* データ行 */}
          <div className="flex flex-col relative pb-8">
            {staff.map((emp, index) => {
              const isDragged = draggedIndex === index;
              return (
                <div
                  key={emp.id}
                  data-row-index={index}
                  onPointerDown={(e) => handlePointerDown(e, index)}
                  onContextMenu={(e) => e.preventDefault()} // スマホ長押し時のポップアップ防止
                  className={`flex items-center px-2 md:px-4 py-3 border-b border-gray-100 bg-white select-none transition-all duration-300 ${
                    isDragged
                      ? 'scale-[1.03] shadow-xl z-50 ring-2 ring-blue-400 opacity-95 rounded-lg -mx-1 my-1'
                      : 'hover:bg-blue-50/50 cursor-pointer'
                  }`}
                  style={{
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                  }}
                >
                  <div className={`w-6 md:w-12 text-center text-[10px] md:text-xs font-mono flex-shrink-0 ${isDragged ? 'text-blue-500 font-bold' : 'text-gray-400'}`}>
                    {index + 1}
                  </div>
                  <div className="w-11 md:w-24 pl-1 md:pl-2 text-[10px] md:text-sm text-gray-500 font-mono flex-shrink-0 truncate">
                    {emp.id}
                  </div>
                  <div className={`flex-1 min-w-0 pl-1 text-sm md:text-base font-medium flex items-center truncate ${isDragged ? 'text-blue-700' : 'text-gray-800'}`}>
                    <span className="truncate">{emp.name}</span>
                  </div>
                  <div className="w-9 md:w-28 flex justify-center flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); // ドラッグ発火を防止
                        toggleCookStatus(emp.id);
                      }}
                      title={emp.canCook ? 'フード対応可' : 'フード対応不可'}
                      className={`flex items-center justify-center rounded-full transition-colors whitespace-nowrap w-8 h-8 md:w-auto md:h-auto md:px-3 md:py-1.5 text-xs font-bold ${
                        emp.canCook
                          ? 'bg-orange-100 text-orange-800 shadow-sm hover:bg-orange-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      <ChefHat size={16} className="md:hidden" />
                      <span className="hidden md:inline-flex md:items-center">
                        {emp.canCook ? (<><ChefHat size={14} className="mr-1" /> 対応可</>) : '不可'}
                      </span>
                    </button>
                  </div>
                  <div className="w-9 md:w-16 flex justify-center flex-shrink-0">
                    <button
                      onClick={(e) => {
                         e.stopPropagation();
                         setStaffPendingDeletion(emp);
                      }}
                      className="p-1 md:p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="この従業員を削除"
                    >
                      <Trash2 size={16} className="md:hidden" />
                      <Trash2 size={18} className="hidden md:block" />
                    </button>
                  </div>
                </div>
              );
            })}
            
            {staff.length === 0 && (
              <div className="p-8 text-center text-gray-500 bg-gray-50/50">
                従業員が登録されていません。「追加」から新しい従業員を登録してください。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderSchedule = () => {
    const isCurrentMonthGenerated = scheduledMonth
      && scheduledMonth.year === targetYear
      && scheduledMonth.month === targetMonth;

    // 対象月ナビゲーション (シフト表ページでも月を切り替えられるようにする)
    const monthNav = (
      <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-center space-x-2 md:space-x-4">
        <button onClick={() => changeMonth(-1)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><ChevronLeft size={20} /></button>
        <span className="text-lg md:text-xl font-bold w-32 md:w-40 text-center">{targetYear}年 {targetMonth}月</span>
        <button onClick={() => changeMonth(1)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><ChevronRight size={20} /></button>
      </div>
    );

    if (!isCurrentMonthGenerated) {
      return (
        <div className="space-y-4 md:space-y-6">
          {monthNav}
          <div className="bg-white p-6 md:p-12 rounded-xl shadow-sm border border-gray-100 text-center flex flex-col items-center justify-center h-full min-h-[400px]">
            <Calendar size={48} className="text-gray-300 mb-4" />
            <h2 className="text-lg md:text-xl font-bold text-gray-700 mb-2">{targetYear}年{targetMonth}月のシフトが未生成です</h2>
            <p className="text-sm md:text-base text-gray-500 mb-6">この月のシフトを自動生成してください。</p>
            <button
              onClick={generateSchedule}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-colors shadow-md"
            >
              この月のシフトを自動生成
            </button>
          </div>
        </div>
      );
    }

    const daySchedule = schedule[selectedDay] || {};
    const dayShortages = shortages[selectedDay] || [];
    // 表示中の日の実際の営業時間帯 (日曜・祝日は 06:30-20:30 に短縮)
    const daySlots = getTimeSlotsForDate(targetYear, targetMonth, selectedDay);

    // その日に1コマでも配置されているスタッフを抽出（元の並び順を維持）
    const workingStaffIds = new Set();
    daySlots.forEach(slot => {
      (daySchedule[slot] || []).forEach(emp => workingStaffIds.add(emp.id));
    });
    const workingStaff = staff.filter(emp => workingStaffIds.has(emp.id));
    const firstDayOfWeek = new Date(targetYear, targetMonth - 1, 1).getDay();

    return (
      <div className="space-y-4 md:space-y-6">
        {monthNav}
        {/* 日付ナビゲーション */}
        <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            onClick={() => setSelectedDay(Math.max(1, selectedDay - 1))}
            disabled={selectedDay === 1}
            className="w-full sm:w-auto flex items-center justify-center space-x-2 text-blue-600 disabled:text-gray-300 hover:bg-blue-50 px-3 py-2 rounded-lg bg-gray-50 sm:bg-transparent"
          >
            <ChevronLeft size={20} />
            <span className="font-medium">前日</span>
          </button>

          <div className="relative order-first sm:order-none">
            <button
              onClick={() => setShowDayPicker(prev => !prev)}
              className="flex items-center justify-center gap-2 text-base md:text-xl font-bold text-gray-800 hover:text-blue-600 px-2 py-1 rounded-lg"
            >
              <span>{targetYear}年 {targetMonth}月 {selectedDay}日 ({getDayOfWeek(selectedDay)})</span>
              <Calendar size={18} className="text-gray-400" />
            </button>

            {showDayPicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowDayPicker(false)}></div>
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 bg-white rounded-xl shadow-lg border border-gray-200 p-3 w-64">
                  <div className="grid grid-cols-7 gap-1 mb-1 text-center text-[10px] font-medium text-gray-400">
                    {DAYS_OF_WEEK.map(d => <div key={d}>{d}</div>)}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                      <div key={`empty-${i}`} />
                    ))}
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
                      <button
                        key={day}
                        onClick={() => { setSelectedDay(day); setShowDayPicker(false); }}
                        className={`aspect-square rounded-lg text-sm flex items-center justify-center transition-colors ${
                          day === selectedDay
                            ? 'bg-blue-600 text-white font-bold'
                            : 'hover:bg-blue-50 text-gray-700'
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setSelectedDay(Math.min(daysInMonth, selectedDay + 1))}
            disabled={selectedDay === daysInMonth}
            className="w-full sm:w-auto flex items-center justify-center space-x-2 text-blue-600 disabled:text-gray-300 hover:bg-blue-50 px-3 py-2 rounded-lg bg-gray-50 sm:bg-transparent"
          >
            <span className="font-medium">翌日</span>
            <ChevronRight size={20} />
          </button>
        </div>

        {/* アラート表示 */}
        {dayShortages.length > 0 && (
          <div className="bg-red-50 border-l-4 border-red-500 p-3 md:p-4 rounded-r-lg shadow-sm">
            <div className="flex items-center space-x-2 text-red-700 mb-2 font-bold text-sm md:text-base">
              <AlertTriangle size={20} className="flex-shrink-0" />
              <span>注意: 条件を満たしていない時間帯があります</span>
            </div>
            <div className="max-h-32 overflow-y-auto">
              <ul className="list-disc pl-5 space-y-1 text-xs md:text-sm text-red-600">
                {dayShortages.map((shortage, idx) => (
                  <li key={idx}>
                    <strong className="whitespace-nowrap">{shortage.slot}:</strong> {shortage.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        
        {dayShortages.length === 0 && (
          <div className="bg-green-50 border-l-4 border-green-500 p-3 md:p-4 rounded-r-lg shadow-sm flex items-center space-x-2 text-green-700">
             <CheckCircle size={20} className="flex-shrink-0" />
             <span className="font-medium text-sm md:text-base">この日のシフトはすべての条件（人数・フード担当）を満たしています。</span>
          </div>
        )}

        {/* シフト表（スタッフ×時間のガントチャート） */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-3 md:p-4 border-b border-gray-100 flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span className="flex items-center"><span className="inline-block w-3 h-3 rounded-full bg-orange-400 mr-1.5"></span>フード対応可</span>
            <span className="flex items-center"><span className="inline-block w-3 h-3 rounded-full bg-blue-400 mr-1.5"></span>フード対応不可</span>
            <span className="flex items-center"><span className="inline-block w-3 h-1.5 rounded-full bg-gray-300 mr-1.5"></span>休憩（6時間以上勤務の場合に1時間）</span>
          </div>
          <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300">
            <table className="border-separate border-spacing-0 table-fixed text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 bg-gray-50 p-2 border-b border-r border-gray-200 text-left w-28 md:w-36 overflow-hidden whitespace-nowrap text-ellipsis">
                    スタッフ ({workingStaff.length}名)
                  </th>
                  {daySlots.map(slot => {
                    const start = slot.substring(0, 5);
                    const isHour = start.endsWith(':00');
                    return (
                      <th
                        key={slot}
                        className={`bg-gray-50 p-0 border-b border-gray-200 text-center align-bottom h-10 w-6 ${isHour ? 'border-l border-gray-300' : ''}`}
                      >
                        {isHour && (
                          <span className="block text-[9px] text-gray-500 pb-1">{start.substring(0, 2)}</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {workingStaff.map(emp => {
                  const flags = daySlots.map(slot => (daySchedule[slot] || []).some(s => s.id === emp.id));
                  const firstIdx = flags.indexOf(true);
                  const lastIdx = flags.lastIndexOf(true);

                  // 勤務範囲内で働いていないコマ = 休憩 (勤務は必ず1ブロックで組まれるため、範囲内の空白は休憩のみ)
                  const breakRange = firstIdx === -1 ? null : (() => {
                    const idx = flags.findIndex((v, i) => !v && i > firstIdx && i < lastIdx);
                    if (idx === -1) return null;
                    let end = idx;
                    while (end + 1 < lastIdx && !flags[end + 1]) end++;
                    return [idx, end];
                  })();

                  const shiftLabel = firstIdx === -1
                    ? ''
                    : `${emp.name}: ${daySlots[firstIdx].split(' - ')[0]} 〜 ${daySlots[lastIdx].split(' - ')[1]}`
                      + (breakRange
                        ? ` (休憩 ${daySlots[breakRange[0]].split(' - ')[0]} 〜 ${daySlots[breakRange[1]].split(' - ')[1]})`
                        : '');

                  return (
                    <tr key={emp.id} className="hover:bg-gray-50">
                      <td className="sticky left-0 z-10 bg-white p-2 border-b border-r border-gray-100 overflow-hidden whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-gray-700 font-medium">
                          <span className="truncate">{emp.name}</span>
                          {emp.canCook && <ChefHat size={12} className="text-orange-500 flex-shrink-0" />}
                        </div>
                      </td>
                      {daySlots.map((slot, i) => {
                        const working = flags[i];
                        const isBreak = breakRange && i >= breakRange[0] && i <= breakRange[1];
                        const isHour = slot.substring(0, 5).endsWith(':00');
                        const prevWorking = i > 0 && flags[i - 1];
                        const nextWorking = i < flags.length - 1 && flags[i + 1];
                        return (
                          <td
                            key={slot}
                            className={`p-0 border-b border-gray-100 h-9 w-6 ${isHour && !prevWorking ? 'border-l border-gray-200' : ''}`}
                          >
                            {working && (
                              <div
                                title={shiftLabel}
                                className={`h-6 my-1.5 ${emp.canCook ? 'bg-orange-400' : 'bg-blue-400'} ${!prevWorking ? 'rounded-l-full ml-0.5' : ''} ${!nextWorking ? 'rounded-r-full mr-0.5' : ''}`}
                              ></div>
                            )}
                            {isBreak && (
                              <div
                                title={shiftLabel}
                                className="h-1.5 my-[15px] mx-1 rounded-full bg-gray-300"
                              ></div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {workingStaff.length === 0 && (
                  <tr>
                    <td colSpan={daySlots.length + 1} className="p-8 text-center text-gray-400 text-sm">
                      この日に出勤予定のスタッフはいません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 md:h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2 md:space-x-3 text-blue-600">
            <Coffee size={24} className="md:w-7 md:h-7" />
            <h1 className="text-lg md:text-xl font-bold tracking-tight">CafeShift Pro</h1>
          </div>
          <div className="hidden sm:block text-xs md:text-sm text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full font-medium">
            店舗: 渋谷3丁目店 (シフト: 06:30 - 21:30 / 日祝は〜20:30)
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4 md:py-8 flex flex-col md:flex-row gap-4 md:gap-8">
        
        {/* Navigation - Mobile Top Tabs / Desktop Sidebar */}
        <aside className="w-full md:w-64 flex-shrink-0 z-10 md:z-auto bg-gray-50 md:bg-transparent sticky top-14 md:top-auto pt-2 md:pt-0 -mx-4 px-4 md:mx-0 md:px-0">
          <nav className="flex md:flex-col space-x-2 md:space-x-0 md:space-y-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex-shrink-0 flex items-center space-x-2 md:space-x-3 px-3 md:px-4 py-2 md:py-3 rounded-lg md:rounded-xl transition-all font-medium text-sm md:text-base whitespace-nowrap ${
                activeTab === 'dashboard'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-gray-600 hover:bg-blue-50 hover:text-blue-600 bg-white md:bg-transparent border md:border-none border-gray-200'
              }`}
            >
              <Settings size={18} className="md:w-5 md:h-5" />
              <span>ダッシュボード</span>
            </button>
            <button
              onClick={() => setActiveTab('trends')}
              className={`flex-shrink-0 flex items-center space-x-2 md:space-x-3 px-3 md:px-4 py-2 md:py-3 rounded-lg md:rounded-xl transition-all font-medium text-sm md:text-base whitespace-nowrap ${
                activeTab === 'trends'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-gray-600 hover:bg-blue-50 hover:text-blue-600 bg-white md:bg-transparent border md:border-none border-gray-200'
              }`}
            >
              <BarChart2 size={18} className="md:w-5 md:h-5" />
              <span>必要人数設定</span>
            </button>
            <button
              onClick={() => setActiveTab('input')}
              className={`flex-shrink-0 flex items-center space-x-2 md:space-x-3 px-3 md:px-4 py-2 md:py-3 rounded-lg md:rounded-xl transition-all font-medium text-sm md:text-base whitespace-nowrap ${
                activeTab === 'input'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-gray-600 hover:bg-blue-50 hover:text-blue-600 bg-white md:bg-transparent border md:border-none border-gray-200'
              }`}
            >
              <Edit size={18} className="md:w-5 md:h-5" />
              <span>希望シフト入力</span>
            </button>
            <button
              onClick={() => setActiveTab('staff')}
              className={`flex-shrink-0 flex items-center space-x-2 md:space-x-3 px-3 md:px-4 py-2 md:py-3 rounded-lg md:rounded-xl transition-all font-medium text-sm md:text-base whitespace-nowrap ${
                activeTab === 'staff'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-gray-600 hover:bg-blue-50 hover:text-blue-600 bg-white md:bg-transparent border md:border-none border-gray-200'
              }`}
            >
              <Users size={18} className="md:w-5 md:h-5" />
              <span>従業員管理</span>
            </button>
            <button
              onClick={() => setActiveTab('schedule')}
              className={`flex-shrink-0 flex items-center space-x-2 md:space-x-3 px-3 md:px-4 py-2 md:py-3 rounded-lg md:rounded-xl transition-all font-medium text-sm md:text-base whitespace-nowrap ${
                activeTab === 'schedule'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-gray-600 hover:bg-blue-50 hover:text-blue-600 bg-white md:bg-transparent border md:border-none border-gray-200'
              }`}
            >
              <Calendar size={18} className="md:w-5 md:h-5" />
              <span>シフト表</span>
            </button>
          </nav>

          {/* Quick Stats in sidebar (Hidden on mobile) */}
          <div className="hidden md:block mt-8 bg-blue-50 p-4 rounded-xl border border-blue-100">
            <h3 className="text-sm font-bold text-blue-800 mb-2">シフト最適化の制約</h3>
            <ul className="text-xs space-y-2 text-blue-700">
              <li className="flex items-center"><CheckCircle size={12} className="mr-1 flex-shrink-0" /> <span>【動的】時間帯ごとに必要人数が変動</span></li>
              <li className="flex items-center"><CheckCircle size={12} className="mr-1 flex-shrink-0" /> <span>【必須】フード担当 最低1人</span></li>
              <li className="flex items-center"><CheckCircle size={12} className="mr-1 flex-shrink-0" /> <span>【最適化】労働時間の平準化</span></li>
            </ul>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 min-w-0">
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'trends' && renderTrends()}
          {activeTab === 'input' && renderPreferenceForm()}
          {activeTab === 'staff' && renderStaff()}
          {activeTab === 'schedule' && renderSchedule()}
        </main>

      </div>

      {/* 従業員削除の確認モーダル */}
      {staffPendingDeletion && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setStaffPendingDeletion(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-800 mb-2">従業員を削除しますか？</h3>
            <p className="text-sm text-gray-600 mb-6">
              <span className="font-semibold">{staffPendingDeletion.name}</span> さんを削除します。この操作は取り消せません。
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setStaffPendingDeletion(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={confirmDeleteStaff}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-colors"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}