{{- define "svc.name" -}}{{ .Release.Name | trunc 63 | trimSuffix "-" }}{{- end -}}

{{- define "svc.selector" -}}
app.kubernetes.io/name: {{ include "svc.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "svc.labels" -}}
{{ include "svc.selector" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "svc.image" -}}
{{- if .Values.image.allowTag -}}
{{ .Values.image.repository }}:{{ .Values.image.tag }}
{{- else -}}
{{ .Values.image.repository }}@{{ .Values.image.digest }}
{{- end -}}
{{- end -}}

{{- define "svc.multiReplica" -}}
{{- if or .Values.autoscaling.enabled (gt (int .Values.replicas) 1) }}true{{ end -}}
{{- end -}}
