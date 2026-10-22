import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  StyleSheet,
} from "react-native";

import { Container } from "@/components/container";
import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/use-color-scheme";
import { trpc } from "@/utils/trpc";

export default function TodosScreen() {
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? NAV_THEME.dark : NAV_THEME.light;
  const [newTodoText, setNewTodoText] = useState("");

  const todos = useQuery(trpc.todo.getAll.queryOptions());
  const createMutation = useMutation(
    trpc.todo.create.mutationOptions({
      onSuccess: () => {
        todos.refetch();
        setNewTodoText("");
      },
    }),
  );
  const toggleMutation = useMutation(
    trpc.todo.toggle.mutationOptions({
      onSuccess: () => {
        todos.refetch();
      },
    }),
  );
  const deleteMutation = useMutation(
    trpc.todo.delete.mutationOptions({
      onSuccess: () => {
        todos.refetch();
      },
    }),
  );

  function handleAddTodo() {
    if (newTodoText.trim()) {
      createMutation.mutate({ text: newTodoText });
    }
  }

  function handleToggleTodo(id: number, completed: boolean) {
    toggleMutation.mutate({ id, completed: !completed });
  }

  function handleDeleteTodo(id: number) {
    Alert.alert("Delete Todo", "Are you sure you want to delete this todo?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteMutation.mutate({ id }),
      },
    ]);
  }

  const isLoading = todos?.isLoading;
  const completedCount = todos?.data?.filter((t) => t.completed).length || 0;
  const totalCount = todos?.data?.length || 0;

  return (
    <Container>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: theme.text }]}>Todo List</Text>
            {totalCount > 0 && (
              <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                <Text style={styles.badgeText}>
                  {completedCount}/{totalCount}
                </Text>
              </View>
            )}
          </View>
        </View>
        <View
          style={[styles.inputCard, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <View style={styles.inputRow}>
            <View style={styles.inputContainer}>
              <TextInput
                value={newTodoText}
                onChangeText={setNewTodoText}
                placeholder="Add a new task..."
                placeholderTextColor={theme.text}
                editable={!createMutation.isPending}
                onSubmitEditing={handleAddTodo}
                returnKeyType="done"
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.background,
                  },
                ]}
              />
            </View>
            <TouchableOpacity
              onPress={handleAddTodo}
              disabled={createMutation.isPending || !newTodoText.trim()}
              style={[
                styles.addButton,
                {
                  backgroundColor:
                    createMutation.isPending || !newTodoText.trim() ? theme.border : theme.primary,
                  opacity: createMutation.isPending || !newTodoText.trim() ? 0.5 : 1,
                },
              ]}
            >
              {createMutation.isPending ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name="add" size={24} color="#ffffff" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {isLoading && (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.loadingText, { color: theme.text, opacity: 0.7 }]}>
              Loading todos...
            </Text>
          </View>
        )}

        {todos?.data && todos.data.length === 0 && !isLoading && (
          <View
            style={[styles.emptyCard, { backgroundColor: theme.card, borderColor: theme.border }]}
          >
            <Ionicons
              name="checkbox-outline"
              size={64}
              color={theme.text}
              style={{ opacity: 0.5, marginBottom: 16 }}
            />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No todos yet</Text>
            <Text style={[styles.emptyText, { color: theme.text, opacity: 0.7 }]}>
              Add your first task to get started!
            </Text>
          </View>
        )}

        {todos?.data && todos.data.length > 0 && (
          <View style={styles.todosList}>
            {todos.data.map((todo) => (
              <View
                key={todo.id}
                style={[
                  styles.todoCard,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
              >
                <View style={styles.todoRow}>
                  <TouchableOpacity
                    onPress={() => handleToggleTodo(todo.id, todo.completed)}
                    style={[styles.checkbox, { borderColor: theme.border }]}
                  >
                    {todo.completed && (
                      <Ionicons name="checkmark" size={16} color={theme.primary} />
                    )}
                  </TouchableOpacity>
                  <View style={styles.todoTextContainer}>
                    <Text
                      style={[
                        styles.todoText,
                        { color: theme.text },
                        todo.completed && {
                          textDecorationLine: "line-through",
                          opacity: 0.5,
                        },
                      ]}
                    >
                      {todo.text}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDeleteTodo(todo.id)}
                    style={styles.deleteButton}
                  >
                    <Ionicons name="trash-outline" size={24} color={theme.notification} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </Container>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  header: {
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 12,
  },
  inputCard: {
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inputContainer: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    padding: 12,
    fontSize: 16,
  },
  addButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  centerContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
  },
  emptyCard: {
    borderWidth: 1,
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
  todosList: {
    gap: 8,
  },
  todoCard: {
    borderWidth: 1,
    padding: 12,
  },
  todoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  todoTextContainer: {
    flex: 1,
  },
  todoText: {
    fontSize: 16,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButton: {
    padding: 4,
  },
});
