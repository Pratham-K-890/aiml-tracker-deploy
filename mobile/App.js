/**
 * Root navigator.
 *
 * Tab 1 — Projects  : Batches → Semesters → Courses → Projects → ProjectDetail / Upload
 * Tab 2 — Chat      : ChatbotScreen
 *
 * Install deps first:
 *   cd mobile && npm install
 */

import React, { useState, useEffect } from 'react';
import { StatusBar, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LoginScreen from './screens/LoginScreen';
import { useFonts, Syne_600SemiBold, Syne_700Bold } from '@expo-google-fonts/syne';
import { SpaceMono_400Regular } from '@expo-google-fonts/space-mono';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { colors, type, spacing } from './theme';

import BatchListScreen     from './screens/BatchListScreen';
import SemesterListScreen  from './screens/SemesterListScreen';
import CourseListScreen    from './screens/CourseListScreen';
import ProjectListScreen   from './screens/ProjectListScreen';
import ProjectDetailScreen from './screens/ProjectDetailScreen';
import UploadScreen        from './screens/UploadScreen';
import ChatbotScreen       from './screens/ChatbotScreen';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

const SCREEN_OPTIONS = {
  headerStyle:     { backgroundColor: colors.bg },
  headerTintColor: colors.accent,
  headerTitleStyle: { ...type.bodyBold, color: colors.text },
  headerBackTitleVisible: false,
  contentStyle:    { backgroundColor: colors.bg },
};

function ProjectsStack() {
  return (
    <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
      <Stack.Screen name="Batches"       component={BatchListScreen}     options={{ title: 'Batches' }} />
      <Stack.Screen name="Semesters"     component={SemesterListScreen}  options={({ route }) => ({ title: route.params?.batchName || 'Semesters' })} />
      <Stack.Screen name="Courses"       component={CourseListScreen}    options={({ route }) => ({ title: route.params?.semLabel  || 'Courses' })} />
      <Stack.Screen name="Projects"      component={ProjectListScreen}   options={({ route }) => ({ title: route.params?.courseName || 'Projects' })} />
      <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} options={{ title: 'Project' }} />
      <Stack.Screen name="Upload"        component={UploadScreen}        options={{ title: 'Upload Sheet' }} />
    </Stack.Navigator>
  );
}

function ChatStack() {
  return (
    <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
      <Stack.Screen name="Chatbot"       component={ChatbotScreen}       options={{ title: 'Ask AI' }} />
      <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} options={{ title: 'Project' }} />
    </Stack.Navigator>
  );
}

function TabIcon({ label, focused }) {
  return (
    <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Syne_600SemiBold, Syne_700Bold,
    SpaceMono_400Regular,
    DMSans_400Regular, DMSans_500Medium, DMSans_700Bold,
  });

  const [token, setToken] = useState(undefined);

  useEffect(() => {
    AsyncStorage.getItem('auth_token').then(t => setToken(t || null));
  }, []);

  if (!fontsLoaded || token === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!token) {
    return <LoginScreen onLogin={() => AsyncStorage.getItem('auth_token').then(t => setToken(t))} />;
  }

  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={({ state, navigation }) => (
          <View style={styles.tabBar}>
            {state.routes.map((route, i) => {
              const focused = state.index === i;
              const labels  = { ProjectsTab: '≡ PROJECTS', ChatTab: '✦ CHAT' };
              return (
                <View
                  key={route.key}
                  style={[styles.tabItem, focused && styles.tabItemActive]}
                >
                  <Text
                    onPress={() => navigation.navigate(route.name)}
                    style={[styles.tabLabel, focused && styles.tabLabelActive]}
                  >
                    {labels[route.name] || route.name}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      >
        <Tab.Screen name="ProjectsTab" component={ProjectsStack} />
        <Tab.Screen name="ChatTab"     component={ChatStack} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderTopWidth: 2,
    borderTopColor: colors.accent,
    height: 56,
  },
  tabItem: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderTopWidth: 3, borderTopColor: 'transparent',
  },
  tabItemActive: {
    borderTopColor: colors.accent,
  },
  tabLabel: {
    ...type.label, color: colors.textMuted,
  },
  tabLabelActive: {
    color: colors.accent,
  },
});
