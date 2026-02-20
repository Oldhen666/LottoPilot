import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initDb } from './src/db/sqlite';
import HomeScreen from './src/screens/HomeScreen';
import CheckTicketScreen from './src/screens/CheckTicketScreen';
import ResultScreen from './src/screens/ResultScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import StatsScreen from './src/screens/StatsScreen';
import InsightsScreen from './src/screens/InsightsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import DrawsListScreen from './src/screens/DrawsListScreen';
import { getRecordById } from './src/db/sqlite';
import type { CheckRecord } from './src/db/sqlite';
import type { LotteryId } from './src/types/lottery';

const Tab = createBottomTabNavigator();

function ResultScreenAsync({
  recordId,
  onDone,
}: {
  recordId: string;
  onDone: () => void;
}) {
  const [record, setRecord] = useState<CheckRecord | null>(null);
  useEffect(() => {
    getRecordById(recordId).then(setRecord);
  }, [recordId]);
  if (!record) return <Text style={{ color: '#94a3b8', padding: 20 }}>Loading...</Text>;
  return <ResultScreen record={record} onDone={onDone} />;
}

function TabHome() {
  const [screen, setScreen] = useState<'home' | 'check' | 'result' | 'draws'>('home');
  const [resultRecordId, setResultRecordId] = useState<string | null>(null);
  const [selectedLottery, setSelectedLottery] = useState<LotteryId>('lotto_max');

  useEffect(() => {
    initDb();
  }, []);

  if (screen === 'check') {
    return (
      <CheckTicketScreen
        preselectedLottery={selectedLottery}
        onBack={() => setScreen('home')}
        onResult={(id) => {
          setResultRecordId(id);
          setScreen('result');
        }}
      />
    );
  }

  if (screen === 'result' && resultRecordId) {
    return (
      <ResultScreenAsync
        recordId={resultRecordId}
        onDone={() => {
          setResultRecordId(null);
          setScreen('home');
        }}
      />
    );
  }

  if (screen === 'draws') {
    return (
      <DrawsListScreen
        lotteryId={selectedLottery}
        onBack={() => setScreen('home')}
      />
    );
  }

  return (
    <HomeScreen
      onSelectLottery={(id) => {
        setSelectedLottery(id);
        setScreen('draws');
      }}
      onCheckTicket={() => setScreen('check')}
    />
  );
}

function TabHistory() {
  const [detail, setDetail] = useState<CheckRecord | null>(null);

  if (detail) {
    return (
      <ResultScreen
        record={detail}
        onDone={() => setDetail(null)}
      />
    );
  }

  return <HistoryScreen onSelectRecord={setDetail} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#1e293b' },
            tabBarActiveTintColor: '#6366f1',
            tabBarInactiveTintColor: '#64748b',
          }}
        >
          <Tab.Screen name="Home" component={TabHome} options={{ tabBarLabel: 'Home' }} />
          <Tab.Screen name="History" component={TabHistory} options={{ tabBarLabel: 'History' }} />
          <Tab.Screen name="Stats" component={StatsScreen} options={{ tabBarLabel: 'Stats' }} />
          <Tab.Screen name="Insights" component={InsightsScreen} options={{ tabBarLabel: 'Insights' }} />
          <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'Settings' }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
