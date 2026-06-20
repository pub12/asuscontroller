'use client';
import '../../scenarios/netwarden_scenarios';
import { AutoTestProvider, AutoTestRunner } from 'hazo_ui/test-harness';
export default function AutotestPage() {
  return (<AutoTestProvider pkg="netwarden"><AutoTestRunner /></AutoTestProvider>);
}
